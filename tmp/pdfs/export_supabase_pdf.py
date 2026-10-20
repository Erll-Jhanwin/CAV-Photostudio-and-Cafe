from __future__ import annotations

import base64
import json
import os
import re
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import dotenv_values
from psycopg2 import sql
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "supabase_complete_data_export.pdf"
MANIFEST = ROOT / "tmp" / "pdfs" / "supabase_export_manifest.json"
MASK = "[REDACTED: credential field]"
SECRET_NAME = re.compile(
    r"(?:pass(?:word)?|secret|token|private.?key|api.?key|credential|"
    r"service.?role|jwt.?secret|encryption.?key|signing.?key)", re.I
)


def safe_cell(value, column_name=""):
    """Stringify PostgreSQL values, masking credential-like fields recursively."""
    if SECRET_NAME.search(str(column_name)):
        return MASK, 1
    if value is None:
        return "NULL", 0
    if isinstance(value, (dict, list, tuple)):
        masks = 0

        def walk(item, key=""):
            nonlocal masks
            if key and SECRET_NAME.search(str(key)):
                masks += 1
                return MASK
            if isinstance(item, dict):
                return {str(k): walk(v, str(k)) for k, v in item.items()}
            if isinstance(item, (list, tuple)):
                return [walk(v) for v in item]
            return item

        return json.dumps(walk(value), ensure_ascii=False, separators=(",", ":"), default=str), masks
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "base64:" + base64.b64encode(bytes(value)).decode("ascii"), 0
    if isinstance(value, (datetime, date, time)):
        return value.isoformat(), 0
    if isinstance(value, Decimal):
        return str(value), 0
    if isinstance(value, bool):
        return "true" if value else "false", 0
    return str(value), 0


class ExportCanvas:
    def __init__(self, path):
        self.c = canvas.Canvas(str(path), pagesize=landscape(A4), pageCompression=1)
        self.width, self.height = landscape(A4)
        self.left = 34
        self.right = self.width - 34
        self.body_width = self.right - self.left
        self.y = self.height - 45
        self.page_no = 1
        self.style = ParagraphStyle(
            "cell", fontName="Helvetica", fontSize=6.4, leading=8,
            textColor=colors.HexColor("#172334"), splitLongWords=1,
            spaceAfter=0, spaceBefore=0,
        )
        self.small = ParagraphStyle(
            "small", fontName="Helvetica", fontSize=7.2, leading=9,
            textColor=colors.HexColor("#27364a"), splitLongWords=1,
        )
        self.masks = 0
        self.record_markers = 0

    def _page_header(self):
        self.c.setFillColor(colors.HexColor("#16324f"))
        self.c.rect(0, self.height - 24, self.width, 24, fill=1, stroke=0)
        self.c.setFillColor(colors.white)
        self.c.setFont("Helvetica-Bold", 8)
        self.c.drawString(self.left, self.height - 16, "CAV PHOTO STUDIO & CAFE  |  SUPABASE DATA EXPORT")
        self.y = self.height - 43

    def new_page(self):
        self.c.setStrokeColor(colors.HexColor("#d6dee8"))
        self.c.line(self.left, 27, self.right, 27)
        self.c.setFillColor(colors.HexColor("#637083"))
        self.c.setFont("Helvetica", 7)
        self.c.drawRightString(self.right, 16, f"Page {self.page_no}")
        self.c.showPage()
        self.page_no += 1
        self._page_header()

    def ensure(self, height):
        if self.y - height < 42:
            self.new_page()

    def paragraph(self, text, x, width, style=None, max_height=None):
        p = Paragraph(text or "", style or self.style)
        _, h = p.wrap(width, max_height or (self.height - 90))
        return p, h

    def text_line(self, text, size=8, bold=False, color="#172334", gap=12):
        self.ensure(gap + 2)
        self.c.setFillColor(colors.HexColor(color))
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        self.c.drawString(self.left, self.y, text)
        self.y -= gap

    def paragraph_line(self, text, style=None, indent=0, gap=3):
        x = self.left + indent
        width = self.body_width - indent
        p, h = self.paragraph(text, x, width, style)
        self.ensure(h + gap)
        p.drawOn(self.c, x, self.y - h)
        self.y -= h + gap

    def start(self):
        self._page_header()
        self.text_line("Complete Supabase Database Export", 20, True, "#16324f", 28)
        self.text_line("Cav Photo Studio & Cafe", 11, True, "#a16a32", 18)

    def inventory(self, tables, total_rows, snapshot_time):
        self.paragraph_line(
            f"Read-only snapshot captured at {snapshot_time}. "
            f"Discovered {len(tables)} base tables and {total_rows:,} records across all non-system schemas.",
            self.small, gap=10,
        )
        self.paragraph_line(
            "Credential protection: credential-like columns and nested fields whose names indicate passwords, "
            "tokens, secrets, private/API keys, credentials, or signing/encryption keys are shown as "
            "[REDACTED: credential field]. Record counts and all column names are retained. Other values are "
            "exported as retrieved. No database data was changed.", self.small, gap=10,
        )
        self.text_line("Table inventory", 13, True, "#16324f", 18)
        widths = [self.body_width * 0.29, self.body_width * 0.12, self.body_width * 0.59]
        headers = ["Table", "Records", "Columns"]
        self._grid_row(headers, widths, header=True)
        for item in tables:
            cols = ", ".join(item["columns"])
            self._grid_row([item["name"], f"{item['count']:,}", cols], widths)
        self.new_page()

    def _grid_row(self, values, widths, header=False):
        cell_style = ParagraphStyle(
            "gridheader" if header else "gridcell", parent=self.small,
            textColor=colors.white if header else colors.HexColor("#27364a"),
            fontName="Helvetica-Bold" if header else "Helvetica",
        )
        ps = [Paragraph(str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), cell_style) for v in values]
        hs = [p.wrap(w - 8, 10000)[1] for p, w in zip(ps, widths)]
        h = max(hs) + 8
        self.ensure(h)
        x = self.left
        bg = colors.HexColor("#16324f") if header else colors.white
        fg = colors.white if header else colors.HexColor("#172334")
        for p, w, ph in zip(ps, widths, hs):
            self.c.setFillColor(bg if header else (colors.HexColor("#f4f7fa") if int(self.y) % 2 else colors.white))
            self.c.setStrokeColor(colors.HexColor("#d6dee8"))
            self.c.rect(x, self.y - h, w, h, fill=1, stroke=1)
            p.drawOn(self.c, x + 4, self.y - 4 - ph)
            x += w
        self.y -= h

    def table_heading(self, item):
        self.text_line(f"Table: {item['name']}", 13, True, "#16324f", 18)
        self.paragraph_line(
            f"Rows in snapshot: {item['count']:,}  |  Columns ({len(item['columns'])}): "
            + ", ".join(item["columns"]), self.small, gap=8,
        )
        self._grid_row(["Column", "Value"], [130, self.body_width - 130], header=True)

    def record(self, table_name, index, columns, values):
        label = f"Record {index:,} of {self._current_count:,}"
        self.ensure(20)
        self.c.setFillColor(colors.HexColor("#e9eff5"))
        self.c.rect(self.left, self.y - 15, self.body_width, 15, fill=1, stroke=0)
        self.c.setFillColor(colors.HexColor("#16324f"))
        self.c.setFont("Helvetica-Bold", 7.2)
        self.c.drawString(self.left + 5, self.y - 10, label)
        self.record_markers += 1
        self.y -= 15
        for col, raw in zip(columns, values):
            value, nmask = safe_cell(raw, col)
            self.masks += nmask
            escaped = (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                       .replace("\n", "<br/>"))
            lw, vw = 122, self.body_width - 122
            label_text = str(col).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            label_p = Paragraph(label_text, self.small)
            value_p = Paragraph(escaped, self.style)
            _, total_h = value_p.wrap(vw - 10, 1000000)
            max_chunk_h = self.height - 105
            chunks = value_p.split(vw - 10, max_chunk_h) if total_h > max_chunk_h else [value_p]
            for part_no, part in enumerate(chunks or [value_p]):
                _, vh = part.wrap(vw - 10, max_chunk_h)
                label = label_p if part_no == 0 else Paragraph(label_text + " (continued)", self.small)
                _, lh = label.wrap(lw - 10, 100000)
                h = max(lh, vh, 11) + 5
                if h > self.y - 42:
                    self.new_page()
                    self.text_line(f"{table_name} - Record {index:,} continued", 8, True, "#16324f", 13)
                else:
                    self.ensure(h)
                h = max(lh, vh, 11) + 5
                self.c.setStrokeColor(colors.HexColor("#d6dee8"))
                self.c.setFillColor(colors.HexColor("#f4f7fa"))
                self.c.rect(self.left, self.y - h, lw, h, fill=1, stroke=1)
                self.c.rect(self.left + lw, self.y - h, vw, h, fill=1, stroke=1)
                label.drawOn(self.c, self.left + 5, self.y - (h - lh) / 2 - lh)
                part.drawOn(self.c, self.left + lw + 5, self.y - (h - vh) / 2 - vh)
                self.y -= h

    @property
    def _current_count(self):
        return self.current_count

    def finish(self):
        self.c.setStrokeColor(colors.HexColor("#d6dee8"))
        self.c.line(self.left, 27, self.right, 27)
        self.c.setFillColor(colors.HexColor("#637083"))
        self.c.setFont("Helvetica", 7)
        self.c.drawRightString(self.right, 16, f"Page {self.page_no}")
        self.c.save()


def main():
    env = dotenv_values(ROOT / "backend" / ".env")
    dsn = env.get("DATABASE_URL") or env.get("SUPABASE_DATABASE_URL")
    if not dsn:
        raise RuntimeError("No DATABASE_URL or SUPABASE_DATABASE_URL configured.")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    conn = psycopg2.connect(dsn, connect_timeout=20)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
    cur = conn.cursor()
    cur.execute("SELECT transaction_timestamp()")
    snapshot_time = cur.fetchone()[0].isoformat()
    cur.execute(
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_type = %s AND table_schema NOT IN (%s, %s) "
        "ORDER BY table_schema, table_name",
        ("BASE TABLE", "pg_catalog", "information_schema"),
    )
    table_keys = cur.fetchall()
    tables = []
    errors = []
    for schema, table in table_keys:
        cur.execute("SAVEPOINT inspect_table")
        try:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
                (schema, table),
            )
            columns = [r[0] for r in cur.fetchall()]
            cur.execute(sql.SQL("SELECT COUNT(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table)))
            count = cur.fetchone()[0]
            tables.append({"schema": schema, "table": table, "name": f"{schema}.{table}", "columns": columns, "count": count})
            cur.execute("RELEASE SAVEPOINT inspect_table")
        except Exception as exc:
            cur.execute("ROLLBACK TO SAVEPOINT inspect_table")
            cur.execute("RELEASE SAVEPOINT inspect_table")
            errors.append({"table": f"{schema}.{table}", "phase": "schema/count", "error": type(exc).__name__})
    total_rows = sum(t["count"] for t in tables)
    pdf = ExportCanvas(OUTPUT)
    pdf.start()
    pdf.inventory(tables, total_rows, snapshot_time)

    for item in tables:
        pdf.table_heading(item)
        pdf.current_count = item["count"]
        fetched = 0
        cur.execute("SAVEPOINT retrieve_table")
        try:
            name = "export_cursor"
            data_cur = conn.cursor(name=name)
            data_cur.itersize = 250
            data_cur.execute(sql.SQL("SELECT * FROM {}.{}").format(sql.Identifier(item["schema"]), sql.Identifier(item["table"])))
            while True:
                batch = data_cur.fetchmany(250)
                if not batch:
                    break
                for row in batch:
                    fetched += 1
                    pdf.record(item["name"], fetched, item["columns"], row)
            data_cur.close()
            cur.execute("RELEASE SAVEPOINT retrieve_table")
            if fetched != item["count"]:
                errors.append({"table": item["name"], "phase": "row validation", "error": f"expected {item['count']}, fetched {fetched}"})
                pdf.text_line(f"Retrieval discrepancy: expected {item['count']:,}, fetched {fetched:,}.", 8, True, "#a23b3b", 14)
        except Exception as exc:
            errors.append({"table": item["name"], "phase": "row retrieval", "error": type(exc).__name__, "fetched": fetched, "expected": item["count"]})
            try:
                data_cur.close()
            except Exception:
                pass
            cur.execute("ROLLBACK TO SAVEPOINT retrieve_table")
            cur.execute("RELEASE SAVEPOINT retrieve_table")
            pdf.text_line(f"Retrieval error after {fetched:,} of {item['count']:,} records: {type(exc).__name__}.", 8, True, "#a23b3b", 14)
        pdf.y -= 20

    if errors:
        pdf.text_line("Retrieval limitations and errors", 14, True, "#a23b3b", 20)
        for error in errors:
            pdf.paragraph_line(json.dumps(error, ensure_ascii=False), self_style := pdf.small, gap=6)
    else:
        pdf.text_line("Retrieval validation", 14, True, "#16324f", 20)
        pdf.paragraph_line(
            f"All {len(tables)} discovered base tables were retrieved. Every fetched row count matched its "
            f"snapshot count ({total_rows:,} total records). Masked credential-bearing values: {pdf.masks:,}.",
            pdf.small, gap=8,
        )
    pdf.finish()
    conn.rollback()
    conn.close()

    manifest = {
        "output": str(OUTPUT),
        "snapshot_time": snapshot_time,
        "table_count": len(tables),
        "expected_total_rows": total_rows,
        "exported_record_markers": pdf.record_markers,
        "masked_credential_values": pdf.masks,
        "errors": errors,
        "tables": [{"name": t["name"], "columns": t["columns"], "expected_rows": t["count"]} for t in tables],
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ["output", "snapshot_time", "table_count", "expected_total_rows", "exported_record_markers", "masked_credential_values", "errors"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Keep database URL and connection details out of diagnostics.
        print(f"Export failed: {type(exc).__name__}", file=sys.stderr)
        raise
