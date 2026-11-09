// ============================================================================
// AgriWatch — Arabic RTL Guide Document Generator (docx-js)
// دليل منصة AgriWatch — مولد المستند
// Cover: Recipe R2 (Double-Rule Frame) + FG-1 palette (agriculture)
// ============================================================================
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableOfContents, SectionType, TableLayoutType,
} = require("docx");
const fs = require("fs");
const path = require("path");
const _is = require("image-size");
const imageSize = _is.imageSize || _is.default || _is;

const OUT = "/home/z/my-project/download/دليل_منصة_AgriWatch.docx";
const DL = "/home/z/my-project/download";

// ── Palette FG-1 (Forest Mint — agriculture) ───────────────────────────────
const P = {
  bg: "0C1F1A", accent: "3DDBB5",
  titleColor: "FFFFFF", subtitleColor: "D8E4DE", metaColor: "C6D3CD", footerColor: "A8BCB2",
  table: { headerBg: "2A7A65", headerText: "FFFFFF", accentLine: "2A7A65",
           innerLine: "C5D8D0", surface: "EDF5F2" },
  headingColor: "1E5B4C",
  body: "000000",
};

const FONT = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Arial" };

const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
};

// ── Run + paragraph helpers (Arabic RTL) ────────────────────────────────────
function ar(text, o = {}) {
  return new TextRun({
    text, rightToLeft: true, font: FONT,
    size: o.size || 22, sizeComplexScript: o.size || 22,
    bold: !!o.bold, boldComplexScript: !!o.bold,
    italics: !!o.italics, color: o.color || P.body,
  });
}
function bodyP(text, o = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: o.align || AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: o.after != null ? o.after : 120, before: o.before || 0 },
    keepNext: !!o.keepNext,
    children: [ar(text, o)],
  });
}
// paragraph from mixed runs [{t, bold, color, size}]
function runsP(runs, o = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: o.align || AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: o.after != null ? o.after : 120, before: o.before || 0 },
    keepNext: !!o.keepNext,
    children: runs.map(r => ar(r.t, r)),
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360, after: 160, line: 380, lineRule: "atLeast" },
    children: [ar(text, { size: 30, bold: true, color: P.headingColor })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 260, after: 120, line: 330, lineRule: "atLeast" },
    children: [ar(text, { size: 25, bold: true, color: P.headingColor })],
  });
}
function bullet(text, o = {}) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { line: 312, after: 60 },
    indent: { right: 280 },
    children: [ar("•  " + text, o)],
  });
}
function stepP(n, title, text) {
  const runs = [ar("الخطوة " + n + ": ", { bold: true, color: P.headingColor }),
                ar(title, { bold: true })];
  if (text) runs.push(ar(" — " + text));
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 100 }, indent: { right: 280 },
    children: runs,
  });
}
function caption(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 240, line: 280 },
    children: [ar(text, { size: 20, color: "555555", italics: true })],
  });
}
function tableTitle(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, keepNext: true,
    spacing: { before: 160, after: 80, line: 300 },
    children: [ar(text, { size: 21, bold: true, color: "333333" })],
  });
}

// ── RTL table builder ───────────────────────────────────────────────────────
// cells: array of either string or {t, fill, color, bold}
function makeTable(headers, rows, widths) {
  const n = headers.length;
  const w = widths || headers.map(() => Math.floor(100 / n));
  const cellP = (val, isHeader) => {
    const o = typeof val === "object" ? val : { t: String(val) };
    return new TableCell({
      width: { size: w[0], type: WidthType.PERCENTAGE },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: isHeader
        ? { type: ShadingType.CLEAR, fill: P.table.headerBg }
        : (o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined),
      verticalAlign: "center",
      children: [new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { line: 280 },
        children: [ar(o.t != null ? o.t : "", {
          size: o.size || 20, bold: isHeader || !!o.bold,
          color: isHeader ? P.table.headerText : (o.color || "1A1A1A"),
        })],
      })],
    });
  };
  const mkRow = (vals, isHeader) => new TableRow({
    tableHeader: !!isHeader, cantSplit: true,
    children: vals.map((v, i) => {
      const o = (typeof v === "object" && v !== null) ? v : { t: String(v) };
      const cell = cellP(v, isHeader);
      // re-create cell with correct width per column
      return new TableCell({
        width: { size: w[i], type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: isHeader
          ? { type: ShadingType.CLEAR, fill: P.table.headerBg }
          : (o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined),
        children: [new Paragraph({
          bidirectional: true, alignment: AlignmentType.RIGHT,
          spacing: { line: 280 },
          children: [ar(o.t != null ? o.t : "", {
            size: o.size || 20, bold: isHeader || !!o.bold,
            color: isHeader ? P.table.headerText : (o.color || "1A1A1A"),
          })],
        })],
      });
    }),
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
    },
    rows: [mkRow(headers, true)].concat(rows.map(r => mkRow(r, false))),
  });
}

// ── Image helper ────────────────────────────────────────────────────────────
function imageBlock(file, displayWidth, capText) {
  const buf = fs.readFileSync(file);
  const dim = imageSize(buf);
  const h = Math.round(displayWidth * dim.height / dim.width);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true,
      spacing: { before: 160, after: 40 },
      children: [new ImageRun({
        data: buf, type: "png",
        transformation: { width: displayWidth, height: h },
      })],
    }),
    caption(capText),
  ];
}

// ── Cover (R2 adapted, Arabic) ──────────────────────────────────────────────
function buildCoverR2() {
  const padL = 1400, padR = 1400;
  const thickBorder = { style: BorderStyle.SINGLE, size: 18, color: P.accent, space: 20 };
  const children = [];

  // 1. top rule
  children.push(new Paragraph({
    indent: { left: padL - 400, right: padR - 400 },
    spacing: { before: 1200, after: 200 },
    border: { top: thickBorder }, children: [],
  }));
  // 2. whitespace
  children.push(new Paragraph({ spacing: { before: 2000 } }));
  // 3. english label
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 500 },
    children: [new TextRun({
      text: "A G R I W A T C H", size: 20, color: P.accent,
      font: { ascii: "Arial", hAnsi: "Arial" }, characterSpacing: 40,
    })],
  }));
  // 4. main title — 40pt, one line
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300, line: Math.ceil(40 * 23), lineRule: "atLeast" },
    children: [ar("دليل منصة AgriWatch", {
      size: 80, bold: true, color: P.titleColor })],
  }));
  // 5. subtitle
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, line: 400, lineRule: "atLeast" },
    children: [ar("منصة ويب عملية لرسم خرائط المحاصيل ورصد استخدامات الأراضي الزراعية",
      { size: 26, color: P.subtitleColor })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300, line: 360, lineRule: "atLeast" },
    children: [ar("برج العرب — محافظة الإسكندرية — جمهورية مصر العربية",
      { size: 22, color: P.subtitleColor })],
  }));
  // 6. whitespace
  children.push(new Paragraph({ spacing: { before: 2600 } }));
  // 7. meta lines — 16pt
  const metaLines = [
    "الهيئة القومية للاستشعار من البعد وعلوم الفضاء (NARSS)",
    "مشروع التخرج 2026 / 2027",
    "بيانات Sentinel-2 وتعلم الآلة على منصة Google Earth Engine",
  ];
  metaLines.forEach(line => {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120, line: Math.ceil(16 * 23), lineRule: "atLeast" },
      children: [ar(line, { size: 26, color: P.metaColor })],
    }));
  });
  // 8. whitespace (push footer toward bottom)
  children.push(new Paragraph({ spacing: { before: 3200 } }));
  // 9. footer + bottom rule
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { left: padL - 400, right: padR - 400 },
    spacing: { before: 200 },
    border: { bottom: thickBorder },
    children: [new TextRun({
      text: "AgriWatch Operational Crop Mapping Platform — 2026",
      size: 18, color: P.footerColor, font: { ascii: "Arial", hAnsi: "Arial" },
    })],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: noBorders, children,
      })],
    })],
  })];
}

// ── Footers ─────────────────────────────────────────────────────────────────
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        children: [PageNumber.CURRENT], size: 18,
        font: { ascii: "Arial", hAnsi: "Arial", cs: "Arial" },
      })],
    })],
  });
}
function bodyHeader() {
  return new Header({
    children: [new Paragraph({
      bidirectional: true, alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine } },
      spacing: { after: 60 },
      children: [ar("دليل منصة AgriWatch — مشروع التخرج 2026/2027",
        { size: 18, color: "666666" })],
    })],
  });
}

// ============================================================================
// CONTENT — BODY
// ============================================================================
const body = [];

// ── 1. نظرة عامة ────────────────────────────────────────────────────────────
body.push(h1("1. نظرة عامة على المنصة"));
body.push(bodyP("AgriWatch هي منصة ويب متخصصة في الزراعة تعمل سحابيًا بالكامل فوق منصة Google Earth Engine، وتستهدف منطقة قسم برج العرب بمحافظة الإسكندرية (مساحة نحو 596 كم مربع). تتيح المنصة لأي مستخدم — دون الحاجة إلى خبرة برمجية — أن يستعرض صور الأقمار الصناعية، ويحدد المنطقة والفترة الزمنية، ويولّد خرائط المحاصيل للمواسم الشتوية والصيفية، ويقارن أداء ثماني خوارزميات تصنيف، ويحصل على مقاييس دقة إحصائية ومساحات كل محصول بالهكتار، ثم يصدّر النتائج كملفات GeoTIFF جاهزة للتحليل في GIS."));
body.push(bodyP("صُممت المنصة على مرحلتين واضحتين تفيان بمتطلبات مشروع التخرج وتبنيان في الوقت نفسه أساسًا للتوسع المستقبلي. المرحلة الأولى (المسلّمة في هذا الدليل) عبارة عن تطبيق تفاعلي GEE App بواجهة ثنائية اللغة (عربي / إنجليزي) يُنشر على رابط عام يستطيع أي شخص استخدامه مجانًا خلال أيام. أما المرحلة الثانية فهي موقع ويب مستقل تمامًا باسم نطاق خاص بالفريق، يعتمد على واجهة أمامية بتقنية Next.js وخادم خلفي بلغة Python يتصل بـ Google Earth Engine من خلال Service Account، وتوضح معماريته بالتفصيل في القسم الحادي عشر."));
body.push(bodyP("من أهم قدرات المنصة التي طلبها فريق المشروع:", { after: 60 }));
body.push(bullet("حرية الاستكشاف: طبقات ألوان طبيعية وNDVI قابلة للتبديل، والضغط على أي نقطة في الخريطة يرسم فورًا منحنى NDVI الزمني عندها."));
body.push(bullet("المواسم والفترات الزمنية: أزرار جاهزة للموسم الشتوي (نوفمبر – أبريل) والصيفي (مايو – أكتوبر) والسنة الكاملة وأي فترة مخصصة."));
body.push(bullet("بيانات المستخدم: رسم عينات تدريب على الخريطة مباشرة، أو استيراد ملف عينات خاص (CSV أو Shapefile) كأصل في GEE."));
body.push(bullet("اختيار الخوارزمية ومقارنة دقتها: ثماني خوارزميات وزر واحد يرتبها جميعًا حسب الدقة الكلية ومعامل كابا."));
body.push(bullet("مخرجات جاهزة: مصفوفة الخطأ، دقة المنتج والمستخدم وF1 لكل فئة، مساحات المحاصيل بالهكتار، وتحميل GeoTIFF."));

// ── 2. ملفات الحزمة ─────────────────────────────────────────────────────────
body.push(h1("2. ملفات الحزمة المسلّمة"));
body.push(bodyP("تتكون الحزمة من ثمانية ملفات متكاملة: أربعة سكريبتات جاهزة للصق في محرر أكواد Google Earth Engine، وملف حدود جغرافي، وقالب لعينات التدريب، ومخططان توضيحيان للتقرير والمناقشة، إضافة إلى هذا الدليل. الجدول التالي يوضح دور كل ملف ومكان استخدامه."));
body.push(tableTitle("جدول 1: مكونات الحزمة وأدوارها"));
body.push(makeTable(
  ["الملف", "الوصف", "مكان الاستخدام"],
  [
    [{t: "AgriWatch_GEE_App.js", size: 18}, "التطبيق التفاعلي الكامل: الواجهة ثنائية اللغة والتصنيف والمقارنة والنتائج", "Code Editor ثم النشر كـ GEE App"],
    [{t: "01_S2_Preprocessing_Features.js", size: 18}, "المعالجة المسبقة لـ Sentinel-2 والمؤشرات والسلاسل الزمنية الشهرية وتصدير رصيد الميزات", "Code Editor"],
    [{t: "02_Supervised_Classification_Accuracy.js", size: 18}, "التصنيف الموجّه بالخوارزميات السبع ومقارنة الدقة ومصفوفة الخطأ وتصدير الخريطة", "Code Editor"],
    [{t: "03_Unsupervised_KMeans.js", size: 18}, "التصنيف غير الموجّه KMeans المحسّن مع مساحات العناقيد وتصدير الخريطة", "Code Editor"],
    [{t: "Bourj_Elarab_AOI.geojson", size: 18}, "حدود قسم برج العرب بدقة كاملة (WGS84)", "للرفع كأصل Table Asset عند الحاجة"],
    [{t: "sample_training_template.csv", size: 18}, "قالب إلزامي التنسيق لعينات التدريب (أمثلة توضيحية فقط)", "الرفع كأصل Table Asset"],
    [{t: "مخطط_خط_المعالجة_AgriWatch.png", size: 18}, "مخطط منهجية المعالجة بخمس مراحل", "تقرير المشروع والمناقشة"],
    [{t: "مخطط_معمارية_الموقع_المستقل.png", size: 18}, "مخطط معمارية المرحلة الثانية", "تقرير المشروع والمناقشة"],
  ],
  [34, 40, 26]
));

// ── 3. التشغيل ──────────────────────────────────────────────────────────────
body.push(h1("3. تجهيز بيئة العمل وتشغيل المنصة"));
body.push(bodyP("التشغيل لا يحتاج أكثر من حساب Google مسجّل في Google Earth Engine (التسجيل مجاني للأغراض البحثية وغير التجارية من خلال earthengine.google.com) ومتصفح إنترنت حديث. جميع الحسابات مؤهَّلة للاستخدام غير التجاري وفق شروط المنصة وقت إعداد هذا الدليل، ويُنصح بمراجعة شروط الاستخدام الحديثة قبل الاعتماد المؤسسي."));
body.push(stepP(1, "افتح محرر الأكواد", "ادخل إلى code.earthengine.google.com واضغط Run بعد لصق السكريبت AgriWatch_GEE_App.js كاملًا."));
body.push(stepP(2, "افحص الواجهة", "ستظهر لوحة تحكم على يسار الخريطة مكتوبة بالعربية افتراضيًا، وزر أعلى اللوحة يحوّلها إلى الإنجليزية والعكس."));
body.push(stepP(3, "حمّل البيانات", "من القسم الثالث اضغط زر تحميل الألوان الطبيعية وNDVI، وانتظر ظهور الطبقات على حدود برج العرب."));
body.push(stepP(4, "أضف عينات التدريب", "من القسم الرابع اختر فئة المحصول ثم شغّل وضع أخذ العينات واضغط على الحقول داخل الخريطة."));
body.push(stepP(5, "شغّل التصنيف وقارن", "من القسم الخامس اختر خوارزمية واضغط تشغيل التصنيف، ثم زر مقارنة كل الخوارزميات لعرض جدول الدقة."));

body.push(h2("3.1 مشاكل وُجدت في السكريبت الأصلي وتم إصلاحها"));
body.push(bodyP("أثناء بناء المنصة رُوجعت النسخة السابقة من سكريبت الفريق وكُشفت ثلاث مشكلات جوهرية عولجت جميعها في الملفات الجديدة، ويُحسن توثيقها في تقرير المشروع لأنها تمس جودة النتائج العلمية."));
body.push(bullet("خطأ الأصل المفقود: رسالة Collection asset not found سببها الإشارة إلى projects/ee-adhamnarss/assets/Bourj_Elarab دون رفع الملف فعلًا. الحل النهائي: دمج الحدود كإحداثيات داخل السكريبت ذاته، فلم يعد رفع أي ملف شرطًا للتشغيل، مع تسليم ملف GeoJSON كامل الدقة لمن يرغب في رفعه كأصل مستقل."));
body.push(bullet("نقطة الرسم البياني خارج المنطقة: النقطة المستخدمة سابقًا عند الإحداثيات (30.20, 30.14) تقع خارج حدود قسم برج العرب تمامًا وتقع في قلب الدلتا، أي أن منحنى NDVI كان يُقاس لمنطقة زراعية أخرى غير منطقة الدراسة. صُححت إلى مركز القسم عند الإحداثيات (29.601, 30.867)."));
body.push(bullet("نظام الإحداثيات للتصدير: المنطقة تقع في نطاق UTM 35N (خط الطول المركزي 27 شرقًا) أي أن الرمز الصحيح EPSG:32635 وليس 32636 المستخدم سابقًا؛ استخدام النطاق المجاور يُحدث انزياحًا وإبطاء في المعالجة. كما أُضيف الاستقطاب VH ونطاقات إضافية عند العمل على Sentinel-1 في المستقبل."));

// ── 4. واجهة المنصة ─────────────────────────────────────────────────────────
body.push(h1("4. شرح واجهة المنصة قسماً بقسم"));
body.push(bodyP("تنتظم لوحة التحكم في ستة أقسام مرقمة تتبع منطق سير العمل من تحديد المنطقة حتى تصدير النتائج، ويعاد بناء اللوحة كاملة بالعربية أو الإنجليزية عند الضغط على زر تبديل اللغة دون فقدان أي من الإعدادات أو العينات المُدخلة."));
body.push(h2("4.1 القسم الأول — منطقة الدراسة"));
body.push(bodyP("تُحمَّل حدود قسم برج العرب افتراضيًا منسوبة إلى أرشيف الأشكال الرسمي. يستطيع المستخدم رسم منطقة خاصة بأدوات الرسم أعلى يسار الخريطة (مستطيل أو مضلع)، أو لصق معرّف أصل جدولي خاص به ثم الضغط على تطبيق. تنعكس أي منطقة جديدة تلقائيًا على الترشيح والتصنيف والإحصاءات والتصدير، وبهذا تصلح المنصة للعمل على أي منطقة زراعية في مصر أو خارجها لا على برج العرب وحدها."));
body.push(h2("4.2 القسم الثاني — الموسم والفترة الزمنية"));
body.push(bodyP("أربعة خيارات جاهزة: الموسم الشتوي من أول نوفمبر إلى آخر أبريل، والموسم الصيفي من أول مايو إلى آخر أكتوبر، والسنة الكاملة، والفترة المخصصة التي تُفتح لها أداة اختيار مدى زمني مرئي يمتد من بداية أرشيف Sentinel-2 السطحي حتى اليوم. يُظهر سطر دائم أسفل القسم الفترة المحسوبة فعليًا بالتواريخ، مع منزلقة لنسبة السحب القصوى للمشاهد المستخدمة في التركيب (5% إلى 40%)."));
body.push(h2("4.3 القسم الثالث — بيانات Sentinel-2"));
body.push(bodyP("زر التحميل يبني مركّبًا موسميًا وسيطًا بعد إزالة السحب ويعرض طبقتين: الألوان الطبيعية وNDVI، ويُظهر في سطر الحالة عدد المشاهد النقية المستخدمة. زر فحص التوفر يطبع عدد الصور المتاحة وأول وآخر تاريخ متاح خلال الفترة المختارة، وهو مفيد قبل اختيار فترات قصيرة أو حديثة جدًا. والضغط على أي نقطة في الخريطة بعد التحميل يرسم منحنى NDVI الزمني عندها داخل لوحة النتائج."));
body.push(h2("4.4 القسم الرابع — عينات التدريب"));
body.push(bodyP("قائمة الفئات الاثنتي عشرة تعرض الرقم والاسم العربي والإنجليزي، وبعد اختيار فئة يُشغَّل وضع أخذ العينات فيتحول كل ضغطة على الخريطة إلى نقطة تدريب ملونة بلون الفئة، مع عدّاد مباشر يبين عدد النقاط لكل فئة. يمكن في أي لحظة مسح النقاط المرسومة أو استيراد عينات جاهزة من أصل جدولي بلصق معرّفه واسم خاصية الفئة فيه، وتُدمج العينات المستوردة مع المرسومة تلقائيًا. التوصية المنهجية: ثلاثون نقطة على الأقل لكل فئة موزعة داخل حقول مختلفة لتغطية التباين المكاني."));
body.push(h2("4.5 القسم الخامس — التصنيف"));
body.push(bodyP("قائمة الخوارزميات تضم سبع خوارزميات موجّهة وخوارزمية KMeans غير الموجّهة، مع إعدادين مساندين: عدد أشجار الغابة العشوائية وعدد عناقيد KMeans. زر التشغيل يدرّب الخوارزمية المختارة على 70% من العينات ويحجز 30% للتحقق، ثم يعرض خريطة التصنيف بألوان الفئات الاثنتي عشرة. زر مقارنة كل الخوارزميات يدرّب السبع الخوارزميات الموجّهة على العينات ذاتها ويعرض جدولًا مرتبًا بالدقة الكلية مع زر عرض بجوار كل خوارزمية لإظهار خريطتها فورًا."));
body.push(h2("4.6 القسم السادس — النتائج والدقة"));
body.push(bodyP("يعرض هذا القسم مخرجات التشغيل: الدقة الكلية ومعامل كابا بخط بارز، وجدول دقة المنتج ودقة المستخدم ودرجة F1 لكل فئة مع عدد نقاط التحقق، ومصفوفة الخطأ المختصرة بأكواد الفئات، ثم مفتاح الخريطة بالألوان، وزر حساب المساحات بالهكتار لكل فئة مع الإجمالي، وأخيرًا رابط تحميل النتيجة GeoTIFF بمقياس قابل للاختيار من 10 إلى 100 متر مع ملاحظة حد الخادم البالغ 50 ميجابايت للتحميل المباشر من التطبيق المنشور، أما التصدير بالدقة الكاملة إلى Google Drive فيتم من سكريبتات محرر الأكواد المرفقة."));

// ── 5. النشر ────────────────────────────────────────────────────────────────
body.push(h1("5. نشر المنصة كتطبيق ويب عام"));
body.push(bodyP("النشر هو ما يحوّل السكريبت من أداة بحثية إلى موقع يستطيع أي شخص استخدامه عبر رابط، دون أن يرى المستخدم سطرًا واحدًا من الكود، وهو ما يجيب على مطلب أن يكون للفريق موقع خاص به يعمل بهذه التقنيات. الخطوات التالية تستغرق دقائق معدودة:"));
body.push(stepP(1, "احفظ السكريبت", "من محرر الأكواد احفظ AgriWatch_GEE_App.js في مستودعك الخاص باسم واضح."));
body.push(stepP(2, "افتح مدير التطبيقات", "اضغط زر Apps في الشريط العلوي لمحرر الأكواد ثم اختر New App."));
body.push(stepP(3, "اختر السكريبت والاسم", "حدد السكريبت المحفوظ واكتب اسم التطبيق مثل AgriWatch — Borj El Arab."));
body.push(stepP(4, "انشر وانسخ الرابط", "اضغط Publish وانسخ الرابط العام الذي يبدأ بـ earthengine.app وشاركه مع أي مستخدم."));
body.push(bodyP("ملاحظات تشغيلية مهمة: أي تعديل على السكريبت لا يظهر في التطبيق المنشور إلا بعد إعادة النشر من شاشة إدارة التطبيق؛ وإذا استخدمت في التطبيق أصولًا خاصة (حدود أو عينات مرفوعة) فيجب مشاركة كل أصل بصلاحية قراءة للجميع وإلا سيرى زوار التطبيق خطأ عدم العثور على الأصل؛ وواجهات رسم المنطقة والعينات على الخريطة تعمل داخل التطبيقات المنشورة أما تصدير المهام إلى Drive فمحجوب في التطبيقات ولهذا وُفر رابط التحميل المباشر داخل المنصة."));

// ── 6. المنهجية ─────────────────────────────────────────────────────────────
body.push(h1("6. المنهجية العلمية للمعالجة"));
body.push(bodyP("تقوم المنهجية على فكرة البصمة الظاهرية: كل محصول يمر بدورة نمو مميزة تُترجم في سلسلة القيم الشهرية للمؤشرات النباتية، فالقمح مثلًا يبني غطاءه تدريجيًا من ديسمبر حتى ذروة في مارس ثم ينخفض فجأة بعد الحصاد في مايو، بينما يبدأ الأرز بانعكاس منخفض بسبب الغمر المائي ثم يرتفع بحدة. بناءً عليه لا يعتمد التصنيف على صورة واحدة بل على رصيد ميزات زمني كامل. يلخص الشكل التالي المراحل الخمس من تحديد المنطقة حتى النشر."));
body.push(...imageBlock(path.join(DL, "مخطط_خط_المعالجة_AgriWatch.png"), 400,
  "شكل 1: خط معالجة منصة AgriWatch من البيانات الخام حتى الخرائط المنشورة"));
body.push(bodyP("تُجلب البيانات من مجموعة COPERNICUS/S2_SR_HARMONIZED وهي انعكاس سطحي مصحح جويًا بدقة 10 أمتار، وتُرشَّح المشاهد التي تتجاوز نسبة السحب فيها الحد المختار، ثم تُزال البكسلات السحابية وظلالها اعتمادًا على نطاق تصنيف المشهد SCL. بعد توحيد قيم الانعكاس بالقسمة على 10000 تُحسب المؤشرات في الجدول التالي لكل مشهد، ويُبنى لكل شهر مركّب وسيط، وتُلحق إحصاءات موسمية موجزة تلتقط التباين الزمني بأقل عدد من النطاقات."));
body.push(tableTitle("جدول 2: المؤشرات الطيفية المحسوبة"));
body.push(makeTable(
  ["المؤشر", "المعادلة", "الدلالة الزراعية"],
  [
    ["NDVI", "(NIR - Red) / (NIR + Red)", "كثافة وحيوية الغطاء النباتي — المؤشر الأساسي"],
    ["NDWI", "(Green - NIR) / (Green + NIR)", "المحتوى المائي للنبات ومسطحات المياه"],
    ["NDMI", "(NIR - SWIR1) / (NIR + SWIR1)", "رطوبة أوراق المحصول — مفيد للتمييز بين المحاصيل"],
    ["EVI", "2.5 x (NIR - Red) / (NIR + 6Red - 7.5 + 1)", "تصحيح تأثير التربة والغلاف الجوي للغطاء الكثيف"],
  ],
  [14, 42, 44]
));
body.push(bodyP("يُختم رصيد الميزات بمئينات NDVI الموسمية عند المستويات (10, 50, 90) إضافة إلى المتوسط والانحراف المعياري ووسيط النطاقات الأساسية، فيصير لكل بكسل وصف ظاهري مركّب يُغذّى إلى الخوارزميات. أما التقسيم الزمني فيتبع نظام الزراعة المصري: الموسم الشتوي من نوفمبر إلى أبريل وتشمل محاصيله الرئيسية القمح والبرسيم وبنجر السكر والفول، والموسم الصيفي من مايو إلى أكتوبر وتشمل محاصيله الذرة والأرز وعباد الشمس، مع إمكانية تحليل أي فترة انتقالية باداة المدى المخصص."));
body.push(tableTitle("جدول 3: المواسم الزراعية في المنصة"));
body.push(makeTable(
  ["الموسم", "الفترة", "أمثلة المحاصيل الرئيسية"],
  [
    ["شتوي", "1 نوفمبر — 30 أبريل", "قمح، برسيم، بنجر سكر، فول، بطاطس شتوي"],
    ["صيفي", "1 مايو — 31 أكتوبر", "ذرة، أرز، عباد شمس، بطاطس صيفي"],
    ["سنة كاملة", "1 يناير — 31 ديسمبر", "تحليل الاستخدامات الأرضية الثابتة مع المحاصيل"],
  ],
  [16, 30, 54]
));

// ── 7. الفئات ───────────────────────────────────────────────────────────────
body.push(h1("7. نظام الفئات والألوان"));
body.push(bodyP("اعتُمد نظام الفئات الاثنتي عشرة المطابق لمفتاح خريطة النتائج التي أنتجها الفريق سابقًا، وهو يجمع بين المحاصيل الحقلية الرئيسية وفئات استخدام الأرض اللازمة لفصل المزارع عن غيرها. تُستخدم الأرقام نفسها كقيم لخاصية class في ملفات العينات، والألوان نفسها في الخرائط والتطبيق، مما يضمن الاتساق بين نتائج المنصة وخرائط ENVI السابقة عند المقارنة البصرية."));
body.push(tableTitle("جدول 4: الفئات الاثنتا عشرة وألوانها المعتمدة"));
body.push(makeTable(
  ["الرقم", "الفئة", "English", "اللون"],
  [
    ["1", "قمح", "Wheat", { t: "#FFFF00", fill: "FFFF00", color: "333333" }],
    ["2", "ذرة", "Maize", { t: "#00FF00", fill: "00FF00", color: "333333" }],
    ["3", "أرز", "Rice", { t: "#00FFFF", fill: "00FFFF", color: "333333" }],
    ["4", "برسيم", "Clover", { t: "#008000", fill: "008000", color: "FFFFFF" }],
    ["5", "بطاطس", "Potato", { t: "#B5651D", fill: "B5651D", color: "FFFFFF" }],
    ["6", "بنجر السكر", "Sugar Beet", { t: "#FF69B4", fill: "FF69B4", color: "333333" }],
    ["7", "فول", "Faba Bean", { t: "#800080", fill: "800080", color: "FFFFFF" }],
    ["8", "عباد الشمس", "Sunflower", { t: "#FF8C00", fill: "FF8C00", color: "333333" }],
    ["9", "بساتين", "Orchards", { t: "#808000", fill: "808000", color: "FFFFFF" }],
    ["10", "أرض بور", "Fallow", { t: "#808080", fill: "808080", color: "FFFFFF" }],
    ["11", "عمران", "Urban", { t: "#FF0000", fill: "FF0000", color: "FFFFFF" }],
    ["12", "مياه", "Water", { t: "#0000FF", fill: "0000FF", color: "FFFFFF" }],
  ],
  [12, 34, 30, 24]
));

// ── 8. الخوارزميات ──────────────────────────────────────────────────────────
body.push(h1("8. الخوارزميات المتاحة ومقارنتها"));
body.push(bodyP("جُمعت الخوارزميات الثماني لتغطي الطيف الذي طلبه الفريق: الأكثر شيوعًا في أبحاث التصنيف الزراعي، ونظيراتها في قوائم ENVI التقليدية، وخيار غير موجّه لا يحتاج عينات أصلًا. جميع الخوارزميات الموجّهة تُدرَّب على العينات ذاتها وعلى رصيد الميزات ذاته، فيكون جدول المقارنة عادلًا ويعكس أثر الخوارزمية لا أثر البيانات."));
body.push(tableTitle("جدول 5: الخوارزميات الثماني في المنصة"));
body.push(makeTable(
  ["الخوارزمية", "النوع", "المزايا وحدود الاستخدام"],
  [
    ["Random Forest", "موجّه", "الأكثر توازنًا ودقة في أبحاث المحاصيل، يتحمل العينات الكثيرة والنطاقات المتعددة، ومقاوم للفرط في التوفيق"],
    ["SVM", "موجّه", "ممتاز مع العينات الصغيرة والفئات متقاربة التوقيع، ويبطؤ مع عشرات الآلاف من النقاط"],
    ["CART", "موجّه", "شجرة قرار واحدة سريعة ونتائجها قابلة للتفسير، وأقل دقة قليلًا من المجموعات"],
    ["Gradient Tree Boost", "موجّه", "تجميع تعزيزي تدريجي دقة عالية مع ضبط جيد، حساس للعينات غير المتوازنة"],
    ["Naive Bayes", "موجّه", "سريع جدًا وأبسط افتراضات، أداء جيد كمخطط أساس للمقارنة"],
    ["Minimum Distance", "موجّه", "نظير خيار ENVI الشهير، يفترض توزيعات دائرية فيضعف مع الفئات المتداخلة"],
    ["Mahalanobis Distance", "موجّه", "يبعد عن مركز كل فئة موزونًا بالتباين، أقوى من أقل مسافة للفئات المترامية"],
    ["KMeans", "غير موجّه", "لا يحتاج عينات، يقسم البكسلات إلى عناقيد تُسمّى يدويًا بمقارنتها بالصور والمنحنيات"],
  ],
  [24, 12, 64]
));
body.push(bodyP("عند الضغط على زر مقارنة كل الخوارزميات تُدرَّب السبع الموجّهة تباعًا وتُحسب لكل منها الدقة الكلية ومعامل كابا من عينات التحقق نفسها، ثم تُعرض مرتبة تنازليًا مع تمييز الأفضل، ولفت الانتباه إلى أن الفروق الصغيرة بين الخوارزميتين الأوليين قد لا تكون جوهرية إذا تداخلت حدود الثقة، والقرار النهائي يُبنى على ثبات الترتيب عبر مواسم أو مناطق متعددة."));

// ── 9. مقاييس الدقة ─────────────────────────────────────────────────────────
body.push(h1("9. مقاييس الدقة وتفسيرها"));
body.push(bodyP("تُقيَّم كل خريطة على ثلث العينات المحجوز الذي لم يرَه النموذج أثناء التدريب (تقسيم عشوائي 70% تدريب و30% تحقق ببذرة ثابتة لضمان قابلية التكرار). من مصفوفة الخطأ الناتجة تُشتق المقاييس الخمسة في الجدول التالي، وهي اللغة المشتركة بين نتائج المنصة وما سيعرض في تقرير المشروع ومناقشته."));
body.push(tableTitle("جدول 6: مقاييس تقييم الدقة"));
body.push(makeTable(
  ["المقياس", "ماذا يقيس", "القراءة العملية"],
  [
    ["الدقة الكلية OA", "نسبة البكسلات المصنفة صحيحًا إلى إجمالي عينات التحقق", "أعلى من 85% ممتاز لمشروع تشغيلي، ومن 70 إلى 85% مقبول ويحتاج تحسين عينات"],
    ["معامل كابا Kappa", "الاتفاق المصحح للمصادفة بين الخريطة والواقع", "فوق 0.8 اتفاق ممتاز، ومن 0.6 إلى 0.8 جيد، وأقل من 0.4 ضعيف"],
    ["دقة المنتج PA", "من زاوية صانع الخريطة: كم من فئة أرضية حقيقية صُنّف صحيحًا", "منخفضة يعني فئة تُفقد أجزاء منها في الخريطة (خطأ حذف)"],
    ["دقة المستخدم UA", "من زاوية مستخدم الخريطة: كم مما صُنّف فئةً هو فعلًا منها", "منخفضة تعني الخريطة تدّعي فئة في أماكن خاطئة (خطأ إضافة)"],
    ["درجة F1", "المتوسط التوافقي لدقتي المنتج والمستخدم لكل فئة", "مؤشر واحد متوازن يكشف الفئات الضعيفة حتى مع OA مرتفع"],
  ],
  [18, 40, 42]
));
body.push(bodyP("علمًا بأن الدقة الكلية وحدها خادعة عند عدم توازن الفئات؛ فقد تبقى ثمانون بالمئة من الأرض قمحًا فيتحقق رقم مرتفع رغم فشل الخريطة في فئة صغيرة كالأرز، ولهذا تُعرض مقاييس الفئة الواحدة جنبًا إلى جنب معها في المنصة."));

// ── 10. بيانات المستخدم ─────────────────────────────────────────────────────
body.push(h1("10. إدخال بيانات المستخدم الخاصة"));
body.push(bodyP("صُمم إدخال البيانات بمسارين يكمل أحدهما الآخر. المسار الأول للرسم المباشر كما شرح في القسم الرابع وهو الأنسب للعينات السريعة أثناء العرض أو التجريب. المسار الثاني للبيانات الحقلية المنظمة: مسوحات GPS أو حدود حقول مرقمة، وتُرفع مرة واحدة ثم تُستورد في أي تشغيل لاحق بمعرّفها. خطوات الرفع:"));
body.push(stepP(1, "جهّز الملف", "ملف CSV بالأعمدة الموضحة في الملحق أ (أو Shapefile مضغوط)، وقيمة الفئة رقم صحيح من 1 إلى 12."));
body.push(stepP(2, "ارفعه كأصل", "من تبويب Assets في محرر الأكواد اضغط New ثم Table upload واختر الملف وانتظر انتهاء الاستيراد."));
body.push(stepP(3, "شاركه للقراءة", "من إعدادات مشاركة الأصل اختر Anyone can read إذا كنت ستستخدمه داخل تطبيق منشور للجمهور."));
body.push(stepP(4, "استورده في المنصة", "الصق معرّف الأصل في خانة استيراد العينات واسم خاصية الفئة إن كانت تختلف عن class ثم اضغط استيراد."));
body.push(bodyP("يتحقق التطبيق من قراءة الأصل ومن وجود خاصية الفئة قبل الدمج، ويطابق أسماء الفئات تلقائيًا في العدّاد والجداول. وينطبق المسار نفسه على رفع حدود مناطق أخرى غير برج العرب من خلال خانة تطبيق منطقة الـ Asset في القسم الأول."));

// ── 11. معمارية الموقع المستقل ──────────────────────────────────────────────
body.push(h1("11. معمارية الموقع المستقل — المرحلة الثانية"));
body.push(bodyP("عندما يرغب الفريق في امتلاك موقع كامل باسم نطاق خاص وواجهة هوية مستقلة عن مظهر Google، تُبنى المرحلة الثانية فوق الحوسبة السحابية نفسها: تبقى المعالجة الثقيلة في Google Earth Engine من خلال حساب خدمة Service Account، بينما تُبنى واجهة أمامية حديثة وخادم خلفي وقاعدة بيانات مكانية تخص الفريق بالكامل. يلخص الشكل التالي الطبقات الخمس للمعمارية من المستخدمين حتى النشر."));
body.push(...imageBlock(path.join(DL, "مخطط_معمارية_الموقع_المستقل.png"), 540,
  "شكل 2: المعمارية المقترحة للموقع المستقل فوق Google Earth Engine"));
body.push(tableTitle("جدول 7: مكونات المعمارية ودورها"));
body.push(makeTable(
  ["الطبقة", "التقنية", "الدور"],
  [
    ["واجهة المستخدم", "Next.js + React-Leaflet / MapLibre", "الخريطة التفاعلية واختيار المنطقة والموسم ولوحات النتائج بلغتين"],
    ["الخادم الخلفي", "Python FastAPI", "المصادقة وخدمات التحليل وطابور المهام وتوليد طبقات الخريطة"],
    ["المعالجة", "GEE API عبر Service Account", "تشغيل التصنيف على أرشيف Sentinel وتصدير النتائج"],
    ["قاعدة البيانات", "PostGIS", "حدود الحقول وعينات التدريب والمستخدمون وسجل التشغيلات"],
    ["التخزين", "Cloud Storage أو S3", "خرائط GeoTIFF وبلاطات العرض المسبق"],
    ["النشر", "Docker على VPS أو Cloud Run", "تشغيل موحد قابل للتوسع مع مراقبة ونسخ احتياطي"],
  ],
  [20, 32, 48]
));
body.push(bodyP("خطة التنفيذ المرحلية المقترحة: تبدأ المرحلة الأولى بتسجيل حساب خدمة في Google Cloud وتمكين Earth Engine API له (وهي متاحة للاستخدامات غير التجارية ضمن شروط المنصة)، ثم بناء الخادم الخلفي بنقطتي نهااء أساسيتين: تشغيل تصنيف لمنطقة وموسم محددين وإرجاع روابط طبقات البلاطات لعرضها فوق الخريطة مباشرة في المتصفح. بعدها تُبنى الواجهة الأمامية بلوحات النتائج والمصادقة، ثم تُضاف قاعدة PostGIS وتخزين النتائج التاريخية لمقارنة المواسم، وأخيرًا النشر الحاوياتي والمراقبة. بهذا الترتيب يظهر موقع يعمل خلال أسابيع من جهد فريق المشروع، وتظل كل طبقة قابلة للاستبدال دون إعادة بناء البقية."));

// ── 12. استكشاف الأخطاء ─────────────────────────────────────────────────────
body.push(h1("12. استكشاف الأخطاء وإصلاحها"));
body.push(bodyP("الجدول التالي يجمع أغلب الرسائل والمواقف التي قد تقابل الفريق أثناء التشغيل أو النشر مع سببها الجذري وعلاجها المباشر، وقد رُتبت بحسب شيوع الحدوث:"));
body.push(tableTitle("جدول 8: المشكلات الشائعة وعلاجها"));
body.push(makeTable(
  ["المشكلة", "السبب", "الحل"],
  [
    ["Collection asset ... Bourj_Elarab not found", "الإشارة إلى أصل لم يُرفع أو غير مشارك", "النسخة الجديدة تدمج الحدود في الكود فلا تحتاج أصلًا؛ أو ارفع ملف GeoJSON المرفق وشاركه للقراءة"],
    ["لا توجد صور للفترة المختارة", "فترة قصيرة أو مستقبلية أو نسبة سحب متشددة", "اضغط فحص توفر البيانات ووسّع الفترة أو ارفع نسبة السحب إلى 30 أو 40%"],
    ["رسالة أن العينات غير كافية للتقييم", "أقل من فئتين أو نقاط تحقق شبه معدومة", "أضف نقاطًا لفئتين على الأقل، والهدف ثلاثون نقطة لكل فئة"],
    ["فشل تحميل GeoTIFF من التطبيق", "تجاوز حد 50 ميجابايت للتحميل المباشر", "اختر مقياسًا أكبر مثل 50 أو 100 متر، أو صدّر من سكريبتات محرر الأكواد إلى Drive بدقة 10 أمتار"],
    ["بطء شديد في SVM", "حساسية الخوارزمية لعدد العينات الكبير", "قلّص العينات المستوردة أو استخدم Random Forest مع النقاط الكثيرة"],
    ["أصل العينات لا يقرأ في التطبيق المنشور", "الأصل غير مشارك للجمهور", "من إعدادات الأصل اختر Anyone can read ثم أعد المحاولة"],
    ["نتائج KMeans لا تطابق أسماء المحاصيل", "التصنيف غير موجّه بطبيعته", "سمِّ العناقيد بمقارنة متوسط NDVI لكل عنقود مع الألوان الطبيعية والمعرفة الحقلية"],
    ["انزياح الخريطة المصدَّرة عند فتحها في GIS", "استخدام نظام إحداثيات مجاور", "المنطقة في UTM 35N أي EPSG:32635، وهو المعتمد في كل ملفات التصدير الجديدة"],
  ],
  [30, 28, 42]
));

// ── 13. التطوير المستقبلي ───────────────────────────────────────────────────
body.push(h1("13. خطة التطوير المستقبلية"));
body.push(bodyP("بُنيت المنصة بمعمارية تسمح بالتوسع دون إعادة كتابة، والاتجاهات التالية مرتبة بحسب أثرها المتوقع وقابلية التنفيذ ضمن موارد فريق المشروع:"));
body.push(bullet("دمج رادار Sentinel-1: إضافة استقطابي VV وVH ومؤشر RVI إلى رصيد الميزات يجعل التصنيف أكثر متانة في المواسم الملبدة، وقد أظهرت دراسات مصرية سابقة أن الدمج يرفع الدقة الكلية إلى ما يقارب 97%، مع جاهزية هيكل الكود لإضافة نطاقات جديدة بسطر واحد لكل نطاق."));
body.push(bullet("التنبيهات الموسمية: تشغيل مجدول شهري يقارن NDVI الحالي بالمتوسط التاريخي ويرصد التأخر في النمو أو الحصاد المبكر لكل فئة."));
body.push(bullet("التحقق الميداني المنظم: تحويل ملف العينات إلى نظام جمع من تطبيق هاتفي بحقول إلزامية وصور مرجعية لرفع جودة التدريب موسمًا بعد موسم."));
body.push(bullet("التوسع الجغرافي: بما أن الحدود أصبحت معاملًا قابلًا للرسم أو الاستيراد، يمكن تكرار التجربة على أقسام ومحافظات أخرى وربط النتائج في لوحة مقارنات وطنية."));
body.push(bullet("واجهة برمجية عامة: كشف نتائج المرحلة الثانية كواجهة REST يستفيد منها باحثون وأنظمة وزارة الزراعة في بناء تقاريرها الخاصة."));

// ── ملحق أ ──────────────────────────────────────────────────────────────────
body.push(h1("الملحق أ: مواصفات ملف عينات التدريب"));
body.push(bodyP("ملف sample_training_template.csv المرفق هو القالب الرسمي؛ يُفتح في أي برنامج جداول ثم يُحفظ بترميز UTF-8 قبل الرفع. الصفوف الموجودة فيه أمثلة توضيحية للتنسيق فقط وليست مواقع حقول حقيقية، ويجب استبدالها بإحداثيات مسح فعلي. الأعمدة الملزِمة أربعة:"));
body.push(tableTitle("جدول 9: أعمدة ملف العينات"));
body.push(makeTable(
  ["العمود", "النوع", "الوصف"],
  [
    ["class", "عدد صحيح 1 إلى 12", "رقم الفئة وفق جدول 4 — هو العمود الذي تقرأه المنصة"],
    ["class_en", "نص", "اسم الفئة بالإنجليزية للتوثيق (اختياري للتشغيل)"],
    ["class_ar", "نص", "اسم الفئة بالعربية للتوثيق (اختياري للتشغيل)"],
    ["longitude", "عدد عشري", "خط الطول بالنظام WGS84 (إحداثيات GPS)"],
    ["latitude", "عدد عشري", "خط العرض بالنظام WGS84 (إحداثيات GPS)"],
  ],
  [18, 24, 58]
));
body.push(bodyP("يقبل الأصل المستورد كذلك ملفات Shapefile لنقاط أو مضلعات حدود الحقول، بشرط وجود حقل رقمي للفئة يُكتب اسمه في خانة خاصية الفئة داخل المنصة. عند استخدام مضلعات تُستخلص قيم كل البكسلات داخلها فيزيد حجم التدريب من كل موقع زيادة كبيرة."));

// ── ملحق ب ──────────────────────────────────────────────────────────────────
body.push(h1("الملحق ب: مراجع تقنية سريعة"));
body.push(tableTitle("جدول 10: الثوابت التقنية المستخدمة في المنصة"));
body.push(makeTable(
  ["البند", "القيمة", "ملاحظات"],
  [
    ["مجموعة البيانات", "COPERNICUS/S2_SR_HARMONIZED", "انعكاس سطحي L2A بدقة 10 م — متاحة من مارس 2017"],
    ["تصفية السحب", "استبعاد فئات SCL التالية: 3, 8, 9, 10, 11", "ظلال وسحب رقيقة وكثيفة وثلج"],
    ["نظام إحداثيات التصدير", "EPSG:32635 (UTM 35N)", "النطاق الصحيح لغرب الدلتا والإسكندرية"],
    ["حد التحميل المباشر", "50 ميجابايت للرابط الواحد", "التطبيقات المنشورة لا تدعم مهام Drive"],
    ["تقسيم العينات", "تدريب 70% وتحقق 30% ببذرة رقم 42", "ثابت لضمان قابلية تكرار النتائج"],
    ["حدود المنصة المنشورة", "رابط عام عبر Earth Engine Apps", "الاستخدام غير التجاري وفق شروط GEE"],
  ],
  [26, 34, 40]
));
body.push(bodyP("لمزيد من التفاصيل الرسمية: توثيق Google Earth Engine على developers.google.com/earth-engine، وصفحات مجموعات بيانات Copernicus Sentinel-2 على موقع المنصة، ودليل نشر التطبيقات Apps من وثائق Earth Engine نفسها.", { after: 240 }));

// ============================================================================
// DOCUMENT ASSEMBLY
// ============================================================================
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 30, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 360, after: 160, line: 380 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT, size: 25, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 260, after: 120, line: 330 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    // ── Section 1: Cover ──
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: buildCoverR2(),
    },
    // ── Section 2: TOC (Roman) ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          bidirectional: true, alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [ar("المحتويات", { size: 32, bold: true, color: P.headingColor })],
        }),
        new TableOfContents("Table of Contents", {
          hyperlink: true,
          headingStyleRange: "1-2",
        }),
        new Paragraph({
          bidirectional: true, spacing: { before: 200 },
          children: [ar("ملاحظة: هذا الفهرس مولّد بحقول تلقائية؛ بعد فتح الملف في Word اضغط بزر الفأرة الأيمن على الفهرس واختر Update Field لتحديث أرقام الصفحات.",
            { size: 20, color: "777777", italics: true })],
        }),
      ],
    },
    // ── Section 3: Body (Arabic numerals from 1) ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageFooter() },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("DOCX written:", OUT, (buf.length / 1024).toFixed(0) + "KB");
});
