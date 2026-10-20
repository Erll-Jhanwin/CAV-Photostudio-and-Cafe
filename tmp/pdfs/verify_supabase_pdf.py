import json
import re
from pathlib import Path

from pypdf import PdfReader
import pypdfium2 as pdfium


root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / "tmp" / "pdfs" / "supabase_export_manifest.json").read_text(encoding="utf-8"))
pdf_path = Path(manifest["output"])
reader = PdfReader(str(pdf_path))
page_text = [page.extract_text() or "" for page in reader.pages]
full_text = "\n".join(page_text)
missing_tables = []
missing_columns = []
count_mismatches = []

for i, table in enumerate(manifest["tables"]):
    heading = "Table: " + table["name"]
    if heading not in full_text:
        missing_tables.append(table["name"])
        continue
    start = full_text.index(heading)
    next_positions = [full_text.find("Table: " + t["name"], start + len(heading)) for t in manifest["tables"][i + 1:]]
    next_positions = [p for p in next_positions if p >= 0]
    end = min(next_positions) if next_positions else len(full_text)
    section = full_text[start:end]
    for column in table["columns"]:
        if column not in section:
            missing_columns.append((table["name"], column))
    marks = re.findall(r"Record\s+([\d,]+)\s+of\s+([\d,]+)", section)
    if len(marks) != table["expected_rows"]:
        count_mismatches.append((table["name"], table["expected_rows"], len(marks)))
    if any(int(total.replace(",", "")) != table["expected_rows"] for _, total in marks):
        count_mismatches.append((table["name"], "marker totals differ from manifest"))

verification = {
    "pdf_bytes": pdf_path.stat().st_size,
    "page_count": len(reader.pages),
    "table_count": len(manifest["tables"]),
    "missing_table_headings": missing_tables,
    "missing_columns": missing_columns,
    "record_count_mismatches": count_mismatches,
    "expected_total_records": manifest["expected_total_rows"],
    "record_markers_in_text": len(re.findall(r"Record\s+([\d,]+)\s+of\s+([\d,]+)", full_text)),
    "credential_redaction_markers": full_text.count("[REDACTED: credential field]"),
    "reported_errors": manifest["errors"],
}
print(json.dumps(verification, ensure_ascii=False))

doc = pdfium.PdfDocument(str(pdf_path))
pages = sorted(set([0, min(1, len(doc) - 1), min(2, len(doc) - 1), len(doc) // 2, len(doc) - 1]))
for page_no in pages:
    bitmap = doc[page_no].render(scale=1.5)
    bitmap.to_pil().save(root / "tmp" / "pdfs" / f"supabase_preview_{page_no + 1:03}.png")

if (missing_tables or missing_columns or count_mismatches
        or verification["record_markers_in_text"] != manifest["expected_total_rows"]
        or manifest["exported_record_markers"] != manifest["expected_total_rows"]
        or manifest["errors"]):
    raise SystemExit("PDF content verification failed")
