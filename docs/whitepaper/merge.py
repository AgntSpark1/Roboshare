"""merge.py OUT COVER BODY BACK: cover + body without its first page + back, sharing resources (needs pypdf)."""
import sys
from pypdf import PdfReader, PdfWriter

out, cover, body, back = sys.argv[1:5]
w = PdfWriter(clone_from=body)
w.remove_page(0)
w.merge(0, PdfReader(cover))
w.append(PdfReader(back))
w.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
w.add_metadata({"/Title": "RoboShare Whitepaper", "/Author": "RoboShare"})
with open(out, "wb") as f:
    w.write(f)
