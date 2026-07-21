import os
import re
from datetime import datetime
from io import BytesIO

import requests
from django.conf import settings


LOW_CONFIDENCE = 0.35


class OcrApiError(Exception):
    pass


def _clean_text(value):
    return re.sub(r'[ \t]+', ' ', value or '').strip()


def _normalize_reference_candidate(value):
    value = re.split(
        r'\b(?:AMOUNT|TOTAL|PHP|DATE|TIME|PAID|SENT|FEE|BALANCE)\b',
        value or '',
        maxsplit=1,
        flags=re.IGNORECASE
    )[0].upper()
    value = value.translate(str.maketrans({
        'O': '0',
        'Q': '0',
        'I': '1',
        'L': '1',
        'S': '5',
        'B': '8',
    }))
    value = re.sub(r'[^A-Z0-9]', '', value)
    digits = ''.join(re.findall(r'\d', value))
    if len(digits) > 13:
        return digits[:13]
    if 10 <= len(digits) <= 13:
        return digits
    digit_count = len(digits)
    if len(value) < 8 or digit_count < 8:
        return ''
    return value


def _extract_reference(text):
    label_patterns = [
        r'(?:gcash\s*)?ref(?:erence)?\.?\s*(?:no\.?|number|#)?',
        r'trace\s*(?:no\.?|number|#)?',
        r'trans(?:action)?\.?\s*(?:id|no\.?|number|#)?',
        r'payment\s*(?:ref(?:erence)?|id|no\.?|number|#)',
    ]
    grouped_reference = r'([A-Z0-9][A-Z0-9\s\-]{7,32}[A-Z0-9])'
    for label_pattern in label_patterns:
        pattern = rf'{label_pattern}\s*[:#\-]?\s*{grouped_reference}'
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            reference = _normalize_reference_candidate(match.group(1))
            if reference:
                return reference, 0.88

    lines = [_clean_text(line) for line in text.splitlines() if _clean_text(line)]
    for index, line in enumerate(lines):
        if not re.search('|'.join(label_patterns), line, re.IGNORECASE):
            continue
        nearby_text = ' '.join(lines[index:index + 3])
        for match in re.finditer(grouped_reference, nearby_text, re.IGNORECASE):
            reference = _normalize_reference_candidate(match.group(1))
            if reference:
                return reference, 0.78

    compact_text = re.sub(r'(?<=\d)\s+(?=\d)', '', text)
    for pattern in [
        r'\b([0-9]{11,16})\b',
        r'\b([A-Z0-9]{10,18})\b',
    ]:
        match = re.search(pattern, compact_text, re.IGNORECASE)
        if match:
            reference = _normalize_reference_candidate(match.group(1))
            if reference:
                return reference, 0.62
    return '', 0.0


def _extract_amount(text):
    patterns = [
        r'(?:amount|total|sent|paid)[:\s]*(?:PHP|P|₱)?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)',
        r'(?:PHP|P|₱)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)',
    ]
    candidates = []
    for index, pattern in enumerate(patterns):
        for match in re.finditer(pattern, text, re.IGNORECASE):
            raw = match.group(1).replace(',', '')
            try:
                amount = float(raw)
            except ValueError:
                continue
            candidates.append((amount, 0.86 if index == 0 else 0.68))
    if not candidates:
        return '', 0.0
    amount, confidence = max(candidates, key=lambda item: item[0])
    return f'{amount:.2f}', confidence


def _parse_datetime_candidate(value):
    value = _clean_text(value.replace('|', ' '))
    formats = [
        '%b %d, %Y %I:%M %p',
        '%B %d, %Y %I:%M %p',
        '%m/%d/%Y %I:%M %p',
        '%m/%d/%y %I:%M %p',
        '%Y-%m-%d %H:%M',
        '%m/%d/%Y %H:%M',
        '%m/%d/%y %H:%M',
        '%b %d, %Y',
        '%B %d, %Y',
        '%m/%d/%Y',
        '%m/%d/%y',
        '%Y-%m-%d',
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(value, fmt)
            return parsed
        except ValueError:
            continue
    return None


def _extract_date_time(text):
    date_patterns = [
        r'([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)',
        r'(\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?)',
        r'(\d{1,2}/\d{1,2}/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)',
    ]
    time_pattern = r'(\d{1,2}:\d{2}\s*(?:AM|PM)?)'

    for pattern in date_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        parsed = _parse_datetime_candidate(match.group(1))
        if parsed:
            date_value = parsed.strftime('%Y-%m-%d')
            time_value = parsed.strftime('%H:%M') if ':' in match.group(1) else ''
            if not time_value:
                time_match = re.search(time_pattern, text, re.IGNORECASE)
                if time_match:
                    time_parsed = _parse_datetime_candidate(f'{match.group(1)} {time_match.group(1)}')
                    if time_parsed:
                        time_value = time_parsed.strftime('%H:%M')
            return date_value, time_value, 0.82 if time_value else 0.58

    time_match = re.search(time_pattern, text, re.IGNORECASE)
    return '', time_match.group(1).strip() if time_match else '', 0.3 if time_match else 0.0


def _build_warnings(fields):
    labels = {
        'reference_number': 'reference number',
        'amount': 'amount paid',
        'payment_date': 'payment date',
        'payment_time': 'payment time',
    }
    warnings = []
    for key, label in labels.items():
        confidence = fields.get(key, {}).get('confidence', 0)
        value = fields.get(key, {}).get('value')
        if not value:
            warnings.append(f'Could not read the {label}. Please enter it manually.')
        elif confidence < LOW_CONFIDENCE:
            warnings.append(f'The {label} looks unclear. Please verify it against the screenshot.')
    return warnings


def parse_gcash_text(text):
    text = _clean_text(text)
    reference, reference_confidence = _extract_reference(text)
    amount, amount_confidence = _extract_amount(text)
    payment_date, payment_time, datetime_confidence = _extract_date_time(text)
    fields = {
        'reference_number': {'value': reference, 'confidence': reference_confidence},
        'amount': {'value': amount, 'confidence': amount_confidence},
        'payment_date': {'value': payment_date, 'confidence': datetime_confidence if payment_date else 0.0},
        'payment_time': {'value': payment_time, 'confidence': datetime_confidence if payment_time else 0.0},
    }
    warnings = _build_warnings(fields)
    return {
        'fields': fields,
        'warnings': warnings,
        'raw_text': text[:3000],
        'overall_confidence': min([field['confidence'] for field in fields.values()] or [0]),
    }


def _read_upload_bytes(uploaded_file):
    image_bytes = uploaded_file.read()
    uploaded_file.seek(0)
    return image_bytes


def _extract_ocr_space_text(payload):
    if not isinstance(payload, dict):
        raise OcrApiError('OCR API returned an invalid response.')
    if payload.get('IsErroredOnProcessing'):
        error_message = payload.get('ErrorMessage') or payload.get('ErrorDetails') or 'OCR API could not process this image.'
        if isinstance(error_message, list):
            error_message = ' '.join(str(message) for message in error_message if message)
        raise OcrApiError(str(error_message))
    parsed_results = payload.get('ParsedResults') or []
    text_parts = []
    for item in parsed_results:
        if isinstance(item, dict) and item.get('ParsedText'):
            text_parts.append(str(item.get('ParsedText')))
    text = '\n'.join(text_parts).strip()
    if not text:
        raise OcrApiError('OCR API did not detect readable receipt text.')
    return text


def _analyze_with_ocr_api(uploaded_file):
    provider = str(getattr(settings, 'OCR_API_PROVIDER', 'ocr_space') or 'ocr_space').strip().lower()
    api_url = str(getattr(settings, 'OCR_API_URL', '') or '').strip()
    api_key = str(getattr(settings, 'OCR_API_KEY', '') or '').strip()
    timeout = int(getattr(settings, 'OCR_API_TIMEOUT', 20) or 20)
    engine = str(getattr(settings, 'OCR_SPACE_ENGINE', '2') or '2').strip()

    if provider not in {'ocr_space', 'ocrspace'}:
        raise OcrApiError('Unsupported OCR_API_PROVIDER. Use ocr_space.')
    if not api_url or not api_key:
        raise OcrApiError('Receipt scanning API is not configured. Please enter the payment details manually.')

    image_bytes = _read_upload_bytes(uploaded_file)
    filename = getattr(uploaded_file, 'name', 'receipt.jpg') or 'receipt.jpg'
    content_type = getattr(uploaded_file, 'content_type', 'application/octet-stream') or 'application/octet-stream'
    try:
        response = requests.post(
            api_url,
            data={
                'apikey': api_key,
                'language': 'eng',
                'isOverlayRequired': 'false',
                'detectOrientation': 'true',
                'scale': 'true',
                'OCREngine': engine,
            },
            files={'file': (filename, image_bytes, content_type)},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.Timeout as exc:
        raise OcrApiError('OCR API timed out. Please try again or enter the details manually.') from exc
    except (requests.RequestException, ValueError) as exc:
        raise OcrApiError('OCR API request failed. Please try again or enter the details manually.') from exc

    result = parse_gcash_text(_extract_ocr_space_text(payload))
    result['ocr_available'] = True
    result['ocr_provider'] = 'ocr_space'
    result['api_used'] = True
    return result


def _analyze_with_tesseract(uploaded_file):
    try:
        from PIL import Image, ImageFilter, ImageOps
        import pytesseract
    except ImportError:
        result = parse_gcash_text('')
        result['warnings'].insert(
            0,
            'OCR service is not installed on the server. Install Pillow, pytesseract, and the Tesseract OCR engine to enable automatic extraction.'
        )
        result['ocr_available'] = False
        result['ocr_provider'] = 'tesseract'
        result['api_used'] = False
        return result

    tesseract_cmd = os.getenv('TESSERACT_CMD')
    default_windows_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if not tesseract_cmd and os.path.exists(default_windows_cmd):
        tesseract_cmd = default_windows_cmd
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    image_bytes = _read_upload_bytes(uploaded_file)
    image = Image.open(BytesIO(image_bytes))
    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)
    if image.width < 1400:
      scale = 1400 / max(image.width, 1)
      image = image.resize((int(image.width * scale), int(image.height * scale)))
    image = image.filter(ImageFilter.SHARPEN)
    thresholded = image.point(lambda pixel: 255 if pixel > 170 else 0)
    try:
        text_parts = []
        for candidate_image in [image, thresholded]:
            for psm in ['6', '11', '12']:
                text_parts.append(pytesseract.image_to_string(candidate_image, config=f'--psm {psm}'))
        text = '\n'.join(text_parts)
    except pytesseract.TesseractNotFoundError:
        result = parse_gcash_text('')
        result['warnings'].insert(
            0,
            'Tesseract OCR engine was not found. Set TESSERACT_CMD to the installed tesseract.exe path.'
        )
        result['ocr_available'] = False
        result['ocr_provider'] = 'tesseract'
        result['api_used'] = False
        return result
    result = parse_gcash_text(text)
    result['ocr_available'] = True
    result['ocr_provider'] = 'tesseract'
    result['api_used'] = False
    return result


def analyze_gcash_receipt(uploaded_file):
    api_error = ''
    if str(getattr(settings, 'OCR_API_PROVIDER', 'ocr_space') or '').strip().lower() not in {'', 'none', 'local', 'tesseract'}:
        try:
            return _analyze_with_ocr_api(uploaded_file)
        except OcrApiError as exc:
            api_error = str(exc)

    if getattr(settings, 'OCR_FALLBACK_TESSERACT', True):
        result = _analyze_with_tesseract(uploaded_file)
        if api_error:
            result.setdefault('warnings', []).insert(0, api_error)
        return result

    result = parse_gcash_text('')
    result['ocr_available'] = False
    result['ocr_provider'] = str(getattr(settings, 'OCR_API_PROVIDER', 'ocr_space') or 'ocr_space')
    result['api_used'] = False
    result['warnings'].insert(0, api_error or 'Receipt scanning API is not configured. Please enter the payment details manually.')
    return result
