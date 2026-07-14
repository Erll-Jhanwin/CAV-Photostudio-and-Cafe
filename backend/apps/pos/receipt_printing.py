import ctypes
import platform
import shutil
import subprocess
import textwrap
from ctypes import wintypes
from decimal import Decimal, InvalidOperation


RECEIPT_WIDTH = 32
POS58_PRINTABLE_DOTS = 384
STORE_LOGO_TEXT = "CAV"
STORE_NAME = "CAV PHOTO STUDIO & CAFE"
STORE_ADDRESS = "028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas"
STORE_CONTACT_NUMBER = "+639171234567"
ESC_POS_MAX_DENSITY = (
    b"\x12#\xff"          # Common POS58 density command: maximum density/darkness.
    b"\x1b7\xff\xff\xff"  # Maximum heat dots, heat time, and heat interval supported by ESC/POS clones.
)


def _as_decimal(value):
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def _money(value):
    return f"PHP {_as_decimal(value):,.2f}"


def _quantity(value):
    qty = _as_decimal(value)
    return str(qty.quantize(Decimal("1"))) if qty == qty.to_integral() else str(qty.normalize())


def _center(text):
    return str(text)[:RECEIPT_WIDTH].center(RECEIPT_WIDTH)


def _center_wrapped(text):
    return [_center(line) for line in _wrap(text)]


def _wrap(text, width=RECEIPT_WIDTH):
    return textwrap.wrap(str(text), width=width, break_long_words=True, replace_whitespace=False) or [""]


def _pair(left, right, width=RECEIPT_WIDTH):
    left = str(left)
    right = str(right)
    if len(left) + 1 + len(right) <= width:
        return [f"{left:<{width - len(right)}}{right}"[:width]]
    if len(right) > width // 2:
        return [left[:width], *_wrap(right, width)]
    left_width = max(width - len(right) - 1, 1)
    wrapped_left = _wrap(left, left_width)
    lines = [f"{wrapped_left[0]:<{left_width}} {right}"[:width]]
    lines.extend(wrapped_left[1:])
    return lines


def _receipt_sections(receipt):
    payment = (receipt.get("payments") or [{}])[0]
    amount_received = receipt.get("amount_received") or payment.get("amount") or receipt.get("total")
    change = receipt.get("change_amount")
    if change is None:
        change = max(_as_decimal(amount_received) - _as_decimal(receipt.get("total")), Decimal("0"))
    receipt_id = receipt.get("or_number") or receipt.get("id") or ""
    transaction_number = receipt.get("transaction_number") or payment.get("transaction_id") or f"POS-{receipt_id}"
    discounts = receipt.get("discounts", "0.00")

    header = [
        _center(receipt.get("business_logo_text") or STORE_LOGO_TEXT),
        _center(receipt.get("business_name") or STORE_NAME),
        *_center_wrapped(receipt.get("business_address") or STORE_ADDRESS),
        *_pair("CONTACT NUMBER", receipt.get("business_contact_number") or STORE_CONTACT_NUMBER),
    ]
    details = [
        *_pair("OR NO.", receipt_id),
        *_pair("TRANSACTION NO.", transaction_number),
        *_pair("DATE & TIME", receipt.get("created_at_display") or receipt.get("created_at", "")),
        *_pair("CASHIER", receipt.get("staff_name") or ""),
    ]
    items = [
        "-" * RECEIPT_WIDTH,
        "ITEMIZED PRODUCTS",
        f"{'QTY':<4}{'UNIT PRICE':>13}{'AMOUNT':>15}",
        "-" * RECEIPT_WIDTH,
    ]

    for item in receipt.get("items") or []:
        name = item.get("product_details", {}).get("name") or "Item"
        items.extend(_wrap(name))
        item_amounts = (
            f"{_quantity(item.get('quantity')):<4}"
            f"{_money(item.get('price')):>13}"
            f"{_money(item.get('subtotal')):>15}"
        )
        items.append(item_amounts[:RECEIPT_WIDTH])

    items.append("-" * RECEIPT_WIDTH)
    totals = [
        *_pair("SUBTOTAL", _money(receipt.get("subtotal") or receipt.get("total"))),
        *_pair("DISCOUNTS", _money(discounts)),
        *_pair("GRAND TOTAL", _money(receipt.get("total"))),
        *_pair("PAYMENT METHOD", payment.get("method") or "CASH"),
        *_pair("CASH RECEIVED", _money(amount_received)),
        *_pair("CHANGE", _money(change)),
    ]

    footer = [
        "-" * RECEIPT_WIDTH,
        _center("Thank You"),
    ]
    return [header, details, items, totals, footer]


def _receipt_text(receipt):
    return "\n".join("\n".join(section) for section in _receipt_sections(receipt)) + "\n\n"


def _end_of_day_sections(report):
    report_date = str(report.get("report_date") or "")
    close_time = report.get("closing_time_display") or report.get("closing_time") or ""
    date_time = f"{report_date} {close_time}".strip()
    header = [
        _center(STORE_NAME),
        _center("Z REPORT"),
    ]
    details = [
        *_pair("DATE & TIME", date_time),
        *_pair("STAFF NAME", report.get("staff_name") or ""),
    ]
    drawer = [
        "-" * RECEIPT_WIDTH,
        "CASH DRAWER",
        *_pair("OPENING CASH", _money(report.get("opening_cash"))),
        *_pair("CASH SALES", _money(report.get("cash_sales"))),
        *_pair("CASH IN/OUT", _money(report.get("cash_in_out"))),
        *_pair("EXPECTED CASH", _money(report.get("expected_cash"))),
        *_pair("ACTUAL CASH", _money(report.get("actual_cash"))),
        *_pair("CASH DIFFERENCE", _money(report.get("cash_difference"))),
    ]
    sales = [
        "-" * RECEIPT_WIDTH,
        "SALES SUMMARY",
        *_pair("GCASH SALES", _money(report.get("gcash_sales"))),
        *_pair("CARD SALES", _money(report.get("card_sales"))),
        *_pair("REFUNDS", _money(report.get("refunds"))),
        *_pair("DISCOUNTS", _money(report.get("discounts"))),
        *_pair("TOTAL TRANSACTIONS", report.get("total_transactions", 0)),
    ]
    totals = [
        "-" * RECEIPT_WIDTH,
        *_pair("GROSS SALES", _money(report.get("gross_sales"))),
        *_pair("FIRST TXN", report.get("first_transaction_id") or "N/A"),
        *_pair("LAST TXN", report.get("last_transaction_id") or "N/A"),
        *_pair("BOOKING INCOME", _money(report.get("booking_income"))),
        *_pair("CAFE/POS INCOME", _money(report.get("cafe_pos_income"))),
        *_pair("ITEMS SOLD", report.get("total_items_sold", 0)),
        *_pair("VOID/CANCEL", report.get("cancelled_or_voided_transactions", 0)),
    ]
    footer = [
        "-" * RECEIPT_WIDTH,
        _center("Report saved for records"),
    ]
    return [header, details, drawer, sales, totals, footer]


def _end_of_day_text(report):
    return "\n".join("\n".join(section) for section in _end_of_day_sections(report)) + "\n\n"


def _encode_receipt_line(line):
    return str(line).encode("cp437", errors="replace") + b"\n"


def _end_of_day_qr_data(report):
    return "|".join([
        f"CAV EOD {report.get('report_date', '')}",
        f"GROSS {_money(report.get('gross_sales'))}",
        f"CASH DIFF {_money(report.get('cash_difference'))}",
        str(report.get("staff_name") or ""),
    ])


def _escpos_qr_bytes(data):
    encoded = str(data).encode("utf-8", errors="replace")
    store_length = len(encoded) + 3
    p_low = store_length & 0xFF
    p_high = (store_length >> 8) & 0xFF
    return (
        b"\x1d(k\x04\x001A2\x00"             # QR model 2
        b"\x1d(k\x03\x001C\x04"              # QR module size 4
        b"\x1d(k\x03\x001E1"                 # QR error correction M
        + bytes([0x1D, 0x28, 0x6B, p_low, p_high, 0x31, 0x50, 0x30])
        + encoded
        + b"\x1d(k\x03\x001Q0"               # Print QR
    )


def _escpos_receipt_bytes(receipt):
    width_low = POS58_PRINTABLE_DOTS & 0xFF
    width_high = (POS58_PRINTABLE_DOTS >> 8) & 0xFF
    sections = _receipt_sections(receipt)
    payload = bytearray()
    payload.extend(
        b"\x1b@"              # Initialize printer
        b"\x1b!\x00"          # Font A 12x24, normal size, normal weight
        b"\x1bM\x00"          # Font A
        b"\x1d!\x00"          # Normal character width/height
        b"\x1bE\x01"          # Emphasis on for darker thermal text
        b"\x1bG\x01"          # Double-strike on for stronger black text
        b"\x1b-\x00"          # Underline off
        b"\x1b3\x18"          # Compact 24-dot line spacing
        b"\x1dL\x00\x00"      # Left margin 0 dots
        + bytes([0x1D, 0x57, width_low, width_high])  # Printable width 384 dots
        + ESC_POS_MAX_DENSITY
    )

    for index, section in enumerate(sections):
        payload.extend(b"\x1ba\x01" if index in (0, 4) else b"\x1ba\x00")
        payload.extend(b"\x1d!\x00")
        for line_index, line in enumerate(section):
            payload.extend(b"\x1bE\x01\x1bG\x01")
            if index == 0 and line_index == 0:
                payload.extend(b"\x1d!\x11")  # Double width and height for the CAV logo text.
                payload.extend(_encode_receipt_line(line.strip()))
                payload.extend(b"\x1d!\x00\n")
                continue
            payload.extend(_encode_receipt_line(line))
        payload.extend(b"\x1d!\x00")
        if index < len(sections) - 1:
            payload.extend(b"\n")

    payload.extend(b"\n\n\n\n\n\x1bE\x00\x1bG\x00\x1dV\x42\x00")
    return bytes(payload)


def _escpos_end_of_day_bytes(report):
    width_low = POS58_PRINTABLE_DOTS & 0xFF
    width_high = (POS58_PRINTABLE_DOTS >> 8) & 0xFF
    sections = _end_of_day_sections(report)
    payload = bytearray()
    payload.extend(
        b"\x1b@"
        b"\x1b!\x00"
        b"\x1bM\x00"
        b"\x1d!\x00"
        b"\x1bE\x01"
        b"\x1bG\x01"
        b"\x1b-\x00"
        b"\x1b3\x18"
        b"\x1dL\x00\x00"
        + bytes([0x1D, 0x57, width_low, width_high])
        + ESC_POS_MAX_DENSITY
    )

    for index, section in enumerate(sections):
        payload.extend(b"\x1ba\x01" if index in (0, 5) else b"\x1ba\x00")
        for line in section:
            payload.extend(b"\x1bE\x01\x1bG\x01")
            payload.extend(_encode_receipt_line(line))
        if index == 0:
            payload.extend(b"\x1ba\x01")
            payload.extend(_escpos_qr_bytes(_end_of_day_qr_data(report)))
            payload.extend(b"\n")
        if index < len(sections) - 1:
            payload.extend(b"\n")

    payload.extend(b"\n\n\n\n\n\x1bE\x00\x1bG\x00\x1dV\x42\x00")
    return bytes(payload)


class _DocInfo(ctypes.Structure):
    _fields_ = [
        ("pDocName", wintypes.LPWSTR),
        ("pOutputFile", wintypes.LPWSTR),
        ("pDatatype", wintypes.LPWSTR),
    ]


class _GdiDocInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_int),
        ("lpszDocName", wintypes.LPCWSTR),
        ("lpszOutput", wintypes.LPCWSTR),
        ("lpszDatatype", wintypes.LPCWSTR),
        ("fwType", wintypes.DWORD),
    ]


class _PrinterInfo4(ctypes.Structure):
    _fields_ = [
        ("pPrinterName", wintypes.LPWSTR),
        ("pServerName", wintypes.LPWSTR),
        ("Attributes", wintypes.DWORD),
    ]


def _get_windows_default_printer():
    winspool = ctypes.WinDLL("winspool.drv")
    needed = wintypes.DWORD(0)
    winspool.GetDefaultPrinterW(None, ctypes.byref(needed))
    if needed.value:
        buffer = ctypes.create_unicode_buffer(needed.value)
        if winspool.GetDefaultPrinterW(buffer, ctypes.byref(needed)):
            return buffer.value

    flags = 0x00000002 | 0x00000004
    bytes_needed = wintypes.DWORD(0)
    returned = wintypes.DWORD(0)
    winspool.EnumPrintersW(flags, None, 4, None, 0, ctypes.byref(bytes_needed), ctypes.byref(returned))
    if not bytes_needed.value:
        return None

    buffer = ctypes.create_string_buffer(bytes_needed.value)
    if not winspool.EnumPrintersW(flags, None, 4, buffer, bytes_needed, ctypes.byref(bytes_needed), ctypes.byref(returned)):
        return None
    if not returned.value:
        return None

    printers = ctypes.cast(buffer, ctypes.POINTER(_PrinterInfo4))
    return printers[0].pPrinterName


def _print_windows_driver(printer_name, content):
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    gdi32.CreateDCW.restype = wintypes.HDC
    gdi32.CreateDCW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p]
    gdi32.GetDeviceCaps.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.CreateFontW.restype = wintypes.HFONT
    gdi32.SelectObject.restype = wintypes.HGDIOBJ
    gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
    gdi32.SetBkMode.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.SetBkColor.argtypes = [wintypes.HDC, wintypes.DWORD]
    gdi32.StartDocW.argtypes = [wintypes.HDC, ctypes.POINTER(_GdiDocInfo)]
    gdi32.StartPage.argtypes = [wintypes.HDC]
    gdi32.TextOutW.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.LPCWSTR, ctypes.c_int]
    gdi32.SetTextColor.argtypes = [wintypes.HDC, wintypes.DWORD]
    gdi32.EndPage.argtypes = [wintypes.HDC]
    gdi32.EndDoc.argtypes = [wintypes.HDC]
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    gdi32.DeleteDC.argtypes = [wintypes.HDC]

    hdc = gdi32.CreateDCW("WINSPOOL", printer_name, None, None)
    if not hdc:
        raise OSError("The default printer driver could not create a printable page.")

    font = None
    old_font = None
    try:
        log_pixels_y = gdi32.GetDeviceCaps(hdc, 90) or 203
        font_height = -int(8.5 * log_pixels_y / 72)
        line_height = max(abs(font_height) + 1, int(log_pixels_y / 11))
        font = gdi32.CreateFontW(
            font_height,
            0,
            0,
            0,
            900,
            0,
            0,
            0,
            0,
            0,
            0,
            3,
            0,
            "Consolas",
        )
        if font:
            old_font = gdi32.SelectObject(hdc, font)
        gdi32.SetBkMode(hdc, 2)
        gdi32.SetBkColor(hdc, 0x00FFFFFF)
        gdi32.SetTextColor(hdc, 0x000000)

        doc_info = _GdiDocInfo(ctypes.sizeof(_GdiDocInfo), "CAV POS Receipt", None, None, 0)
        if gdi32.StartDocW(hdc, ctypes.byref(doc_info)) <= 0:
            raise OSError("The print job could not be started by the printer driver.")
        try:
            if gdi32.StartPage(hdc) <= 0:
                raise OSError("The receipt page could not be started by the printer driver.")

            y = 0
            for line in content.splitlines():
                # TextOutW uses the installed printer driver, avoiding blank RAW jobs.
                gdi32.TextOutW(hdc, 0, y, line, len(line))
                y += line_height

            if gdi32.EndPage(hdc) <= 0:
                raise OSError("The receipt page could not be completed by the printer driver.")
        finally:
            gdi32.EndDoc(hdc)
    finally:
        if old_font:
            gdi32.SelectObject(hdc, old_font)
        if font:
            gdi32.DeleteObject(font)
        gdi32.DeleteDC(hdc)


def _print_windows_raw(printer_name, payload):
    winspool = ctypes.WinDLL("winspool.drv")
    handle = wintypes.HANDLE()
    if not winspool.OpenPrinterW(printer_name, ctypes.byref(handle), None):
        raise OSError("The default printer driver could not be opened.")

    try:
        doc_info = _DocInfo("CAV POS Receipt", None, "RAW")
        if not winspool.StartDocPrinterW(handle, 1, ctypes.byref(doc_info)):
            raise OSError("The print job could not be started.")
        try:
            if not winspool.StartPagePrinter(handle):
                raise OSError("The receipt page could not be started.")

            written = wintypes.DWORD(0)
            if not winspool.WritePrinter(handle, payload, len(payload), ctypes.byref(written)):
                raise OSError("The receipt could not be sent to the printer.")
            winspool.EndPagePrinter(handle)
        finally:
            winspool.EndDocPrinter(handle)
    finally:
        winspool.ClosePrinter(handle)


def _print_posix(content):
    lp = shutil.which("lp") or shutil.which("lpr")
    if not lp:
        return None, "No printer command is available on this system."

    command = [lp, "-o", "media=Custom.58x200mm", "-o", "page-left=0", "-o", "page-right=0", "-o", "page-top=0", "-o", "page-bottom=0"]
    result = subprocess.run(command, input=content.encode("utf-8"), capture_output=True, timeout=10)
    if result.returncode != 0:
        return None, (result.stderr.decode("utf-8", errors="replace").strip() or "The receipt could not be printed.")
    return "default", None


def print_receipt(receipt):
    content = _receipt_text(receipt)
    raw_payload = _escpos_receipt_bytes(receipt)
    system = platform.system().lower()

    try:
        if system == "windows":
            printer_name = _get_windows_default_printer()
            if not printer_name:
                return {
                    "printed": False,
                    "printer": None,
                    "error": "Payment saved, but no default or available printer driver was found. Set a 58 mm receipt printer as the Windows default printer and try again.",
                }
            try:
                _print_windows_raw(printer_name, raw_payload)
                return {"printed": True, "printer": printer_name, "error": ""}
            except Exception:
                _print_windows_driver(printer_name, content)
                return {"printed": True, "printer": printer_name, "error": ""}

        printer_name, error = _print_posix(content)
        if error:
            return {"printed": False, "printer": None, "error": f"Payment saved, but no receipt printer is available. {error}"}
        return {"printed": True, "printer": printer_name, "error": ""}
    except Exception as exc:
        return {
            "printed": False,
            "printer": None,
            "error": f"Payment saved, but the receipt could not be printed: {exc}",
        }


def print_end_of_day_report(report):
    content = _end_of_day_text(report)
    raw_payload = _escpos_end_of_day_bytes(report)
    system = platform.system().lower()

    try:
        if system == "windows":
            printer_name = _get_windows_default_printer()
            if not printer_name:
                return {
                    "printed": False,
                    "printer": None,
                    "error": "Report saved, but no default or available printer driver was found. Set a 58 mm receipt printer as the Windows default printer and try again.",
                }
            try:
                _print_windows_raw(printer_name, raw_payload)
                return {"printed": True, "printer": printer_name, "error": ""}
            except Exception:
                _print_windows_driver(printer_name, content)
                return {"printed": True, "printer": printer_name, "error": ""}

        printer_name, error = _print_posix(content)
        if error:
            return {"printed": False, "printer": None, "error": f"Report saved, but no receipt printer is available. {error}"}
        return {"printed": True, "printer": printer_name, "error": ""}
    except Exception as exc:
        return {
            "printed": False,
            "printer": None,
            "error": f"Report saved, but the end-of-day report could not be printed: {exc}",
        }
