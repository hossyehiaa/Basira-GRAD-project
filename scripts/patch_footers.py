# -*- coding: utf-8 -*-
"""Post-process the AgriWatch guide docx:
1. Patch footer PAGE fields: TOC section footer -> \\* ROMAN, body -> \\* arabic
2. Remove empty <w:pgNumType/> tags (cover section)
"""
import re
import shutil
import sys
import zipfile

DOCX = '/home/z/my-project/download/دليل_منصة_AgriWatch.docx'
TMP = '/tmp/docx_patch'

shutil.rmtree(TMP, ignore_errors=True)
with zipfile.ZipFile(DOCX) as z:
    z.extractall(TMP)

doc_path = f'{TMP}/word/document.xml'
with open(doc_path, encoding='utf-8') as f:
    doc = f.read()

# ── 1. map sections (in order) to their default footer rIds ──
sectprs = re.findall(r'<w:sectPr[^>]*>.*?</w:sectPr>', doc, re.S)
print('sections found:', len(sectprs))
sec_footers = []
for sp in sectprs:
    m = re.search(r'<w:footerReference w:type="default" r:id="(rId\d+)"', sp)
    sec_footers.append(m.group(1) if m else None)
print('section footer rIds:', sec_footers)

rels_path = f'{TMP}/word/_rels/document.xml.rels'
with open(rels_path, encoding='utf-8') as f:
    rels = f.read()
rid2file = dict(re.findall(r'<Relationship Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))
print('rid->file:', rid2file)

def patch_footer(fname, fmt):
    p = f'{TMP}/word/{fname}'
    with open(p, encoding='utf-8') as f:
        xml = f.read()
    xml2, n = re.subn(
        r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
        rf'\1 PAGE \\* {fmt} \\* MERGEFORMAT \2', xml)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(xml2)
    print(f'patched {fname} -> {fmt} ({n} fields)')

# section order: 0=cover (no footer), 1=TOC (Roman), 2=body (arabic)
if len(sec_footers) >= 3:
    if sec_footers[1] and sec_footers[1] in rid2file:
        patch_footer(rid2file[sec_footers[1]], 'ROMAN')
    if sec_footers[2] and sec_footers[2] in rid2file:
        patch_footer(rid2file[sec_footers[2]], 'arabic')

# ── 2. remove empty pgNumType (cover) ──
doc2, n2 = re.subn(r'<w:pgNumType/>', '', doc)
print('removed empty pgNumType:', n2)

# ── 3. Fix duplicated first TOC entry + fill its PAGEREF stored result ────
# The placeholder script injected entry 1 twice: once inside the TOC field
# (hyperlink, PAGEREF without stored result => no page number shown) and once
# as a plain paragraph. Fix: give the in-field entry a stored page number
# "1", drop the plain duplicate paragraph, and repair the \\h instruction.

# 3a. split merged PAGEREF field + insert stored result "1"
pat = re.compile(
    r'(PAGEREF _Toc1 \\h</w:instrText>'
    r'<w:fldChar w:fldCharType="separate"/>)<w:fldChar w:fldCharType="end"/>')
doc2, n3a = pat.subn(
    r'\1</w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>',
    doc2)
print('pageref fields fixed:', n3a)

# 3b. remove the plain duplicate TOC1 paragraph for entry 1
paras = list(re.finditer(r'<w:p\b[^>]*>.*?</w:p>', doc2, re.S))
removed = 0
for pm in reversed(paras):
    seg = pm.group(0)
    if ('w:val="TOC1"' in seg and 'PAGEREF' not in seg and
            '>1. نظرة عامة على المنصة<' in seg):
        doc2 = doc2[:pm.start()] + doc2[pm.end():]
        removed += 1
print('duplicate plain entry removed:', removed)

with open(doc_path, 'w', encoding='utf-8') as f:
    f.write(doc2)

# ── rezip ──
import os
out = DOCX
if os.path.exists(out):
    os.remove(out)
zf = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(TMP):
    for fn in files:
        full = os.path.join(root, fn)
        rel = os.path.relpath(full, TMP)
        zf.write(full, rel)
zf.close()
print('repacked:', out)
