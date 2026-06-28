const pptxgen = require("pptxgenjs");
const path = require("path");

const OUT = "/Users/baojiale/Documents/英语趣味学习/outputs/craft-digital-exhibition";
const A = path.join(OUT, "assets");
const IMG = {
  cover: path.join(A, "style-museum.png"),
  color: path.join(A, "demo-color-ai.png"),
  bamboo: path.join(A, "demo-bamboo-scan.png"),
  textile: path.join(A, "demo-textile.png"),
};
const FILE = path.join(OUT, "传统工艺数字展陈交互装置设计方案.pptx");

const pptx = new pptxgen();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Codex";
pptx.subject = "传统工艺类交互装置/数字展陈设计";
pptx.title = "纹样新生：传统工艺数字展陈交互装置设计方案";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "PingFang SC",
  bodyFontFace: "PingFang SC",
  lang: "zh-CN",
};

const W = 13.333;
const H = 7.5;
const C = {
  paper: "F6F0E5",
  panel: "FFFDF8",
  ink: "191510",
  sub: "6A6257",
  line: "D8CCB8",
  red: "9E2B20",
  lacquer: "5A1612",
  bamboo: "B6905C",
  blue: "153F68",
  gold: "B98A2E",
  black: "111111",
  jade: "496B5A",
};

function bg(slide) {
  slide.background = { color: C.paper };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.paper }, line: { color: C.paper } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: C.black }, line: { color: C.black } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.11, w: W, h: 0.11, fill: { color: C.gold }, line: { color: C.gold } });
  for (let x = 0.65; x < W; x += 0.65) {
    slide.addShape(pptx.ShapeType.line, { x, y: 0.35, w: 0, h: 6.65, line: { color: "E8DDCA", transparency: 55, width: 0.35 } });
  }
  for (let y = 0.45; y < H; y += 0.65) {
    slide.addShape(pptx.ShapeType.line, { x: 0.45, y, w: 12.45, h: 0, line: { color: "E8DDCA", transparency: 60, width: 0.35 } });
  }
}

function header(slide, no, label, title) {
  slide.addText(String(no).padStart(2, "0"), { x: 0.58, y: 0.42, w: 0.55, h: 0.22, fontFace: "Aptos Display", fontSize: 11, bold: true, color: C.red, margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 1.18, y: 0.54, w: 1.25, h: 0, line: { color: C.red, width: 2 } });
  slide.addText(label, { x: 2.56, y: 0.43, w: 3.3, h: 0.20, fontSize: 8.2, bold: true, color: C.sub, charSpace: 1.0, margin: 0 });
  slide.addText(title, { x: 0.58, y: 0.82, w: 10.9, h: 0.48, fontSize: 22, bold: true, color: C.ink, fit: "shrink", margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 0.58, y: 1.42, w: 12.1, h: 0, line: { color: C.line, width: 1 } });
}

function footer(slide, no) {
  slide.addText(`传统工艺类 · 交互装置 / 数字展陈设计 · ${String(no).padStart(2, "0")}`, {
    x: 0.58, y: 7.12, w: 5.1, h: 0.18, fontSize: 7.2, color: C.sub, margin: 0,
  });
}

function label(slide, text, x, y, color = C.red) {
  slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.10, w: 0.40, h: 0.04, fill: { color }, line: { color } });
  slide.addText(text, { x: x + 0.50, y, w: 3.2, h: 0.20, fontSize: 8.5, bold: true, color: C.sub, charSpace: 0.8, margin: 0 });
}

function card(slide, x, y, w, h, title, body, accent = C.red) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.panel }, line: { color: C.line, width: 0.9 } });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.07, h, fill: { color: accent }, line: { color: accent } });
  slide.addText(title, { x: x + 0.20, y: y + 0.20, w: w - 0.4, h: 0.25, fontSize: 12, bold: true, color: C.ink, margin: 0 });
  slide.addText(body, { x: x + 0.20, y: y + 0.58, w: w - 0.4, h: h - 0.74, fontSize: 9.2, color: C.sub, fit: "shrink", margin: 0 });
}

function bullet(slide, items, x, y, w, color = C.red) {
  items.forEach((t, i) => {
    const yy = y + i * 0.58;
    slide.addShape(pptx.ShapeType.rect, { x, y: yy + 0.08, w: 0.07, h: 0.07, fill: { color }, line: { color } });
    slide.addText(t, { x: x + 0.22, y: yy, w, h: 0.32, fontSize: 10.5, color: C.ink, fit: "shrink", margin: 0 });
  });
}

function imageFrame(slide, img, x, y, w, h) {
  slide.addShape(pptx.ShapeType.rect, { x: x + 0.06, y: y + 0.06, w, h, fill: { color: "D3C4A8", transparency: 35 }, line: { color: "D3C4A8", transparency: 100 } });
  slide.addImage({ path: img, x, y, w, h });
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: "FFFFFF", transparency: 100 }, line: { color: C.line, width: 1.0 } });
}

function swatch(slide, x, y, colors, labels) {
  colors.forEach((c, i) => {
    slide.addShape(pptx.ShapeType.rect, { x: x + i * 0.72, y, w: 0.52, h: 0.52, fill: { color: c }, line: { color: C.line, width: 0.5 } });
    if (labels && labels[i]) slide.addText(labels[i], { x: x + i * 0.72 - 0.08, y: y + 0.62, w: 0.70, h: 0.14, fontSize: 6.5, color: C.sub, align: "center", margin: 0 });
  });
}

function processLine(slide, steps, x, y, w) {
  const gap = 0.26;
  const bw = (w - gap * (steps.length - 1)) / steps.length;
  steps.forEach((s, i) => {
    const xx = x + i * (bw + gap);
    slide.addShape(pptx.ShapeType.rect, { x: xx, y, w: bw, h: 0.88, fill: { color: i % 2 ? "F2E7D5" : C.panel }, line: { color: C.line } });
    slide.addText(String(i + 1).padStart(2, "0"), { x: xx + 0.14, y: y + 0.17, w: 0.34, h: 0.18, fontFace: "Aptos", fontSize: 8, bold: true, color: i % 2 ? C.blue : C.red, margin: 0 });
    slide.addText(s, { x: xx + 0.48, y: y + 0.15, w: bw - 0.58, h: 0.42, fontSize: 9.0, bold: true, color: C.ink, fit: "shrink", margin: 0 });
    if (i < steps.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, { x: xx + bw + 0.05, y: y + 0.32, w: 0.14, h: 0.18, fill: { color: C.gold }, line: { color: C.gold } });
    }
  });
}

// 1 Cover
{
  const s = pptx.addSlide();
  s.addImage({ path: IMG.cover, x: 0, y: 0, w: W, h: H });
  s.addShape(pptx.ShapeType.rect, { x: 0.68, y: 0.75, w: 5.05, h: 5.95, fill: { color: "FFFDF8", transparency: 4 }, line: { color: C.line, width: 1.1 } });
  label(s, "传统工艺类 · 数字展陈设计", 1.02, 1.12, C.red);
  s.addText("纹样新生", { x: 1.02, y: 1.76, w: 3.5, h: 0.55, fontSize: 30, bold: true, color: C.ink, margin: 0 });
  s.addText("传统工艺数字展陈交互装置设计方案", { x: 1.02, y: 2.48, w: 4.18, h: 0.72, fontSize: 18, bold: true, color: C.ink, fit: "shrink", margin: 0 });
  s.addShape(pptx.ShapeType.line, { x: 1.02, y: 3.42, w: 4.1, h: 0, line: { color: C.ink, width: 1.2 } });
  s.addText("以大漆髹饰、嘉定竹刻、苏州织锦与明清刺绣为内容基础，构建“材料可感知、工艺可拆解、色彩可共创”的数字展陈体验。", {
    x: 1.02, y: 3.74, w: 4.02, h: 0.95, fontSize: 10.8, color: C.sub, fit: "shrink", margin: 0,
  });
  swatch(s, 1.02, 5.45, ["5A1612", "9E2B20", "B6905C", "153F68", "B98A2E"], ["漆", "朱", "竹", "靛", "金"]);
}

// 2 Assignment response
{
  const s = pptx.addSlide(); bg(s); header(s, 2, "BRIEF RESPONSE", "作业要求与方案定位");
  imageFrame(s, IMG.cover, 0.72, 1.78, 5.25, 2.95);
  const items = [
    ["类别选择", "传统工艺类：大漆髹饰、嘉定竹刻、苏州织锦、明清刺绣。", C.red],
    ["设计方向", "交互装置 / 数字展陈：AI 配色、数字扫描、AR/分层解析。", C.blue],
    ["方案目标", "让观众从“看展品”转向“理解工艺如何生成”。", C.gold],
    ["输出形式", "PPT 中同时呈现方案文本、体验流程、空间关系与演示图片。", C.jade],
  ];
  items.forEach((it, i) => card(s, 6.35 + (i % 2) * 2.95, 1.78 + Math.floor(i / 2) * 1.55, 2.58, 1.22, it[0], it[1], it[2]));
  processLine(s, ["工艺认知", "数字采集", "交互生成", "现场体验", "传播延展"], 0.92, 5.65, 11.45);
  footer(s, 2);
}

// 3 Craft research matrix
{
  const s = pptx.addSlide(); bg(s); header(s, 3, "CRAFT RESEARCH", "四类传统工艺的数字化转译");
  const data = [
    ["大漆髹饰", "漆层、光泽、螺钿、描金", "传统色 AI 配色；漆层剖面可视化", C.lacquer],
    ["嘉定竹刻", "以刀代笔、浅浮雕、文人气", "3D 扫描；刀痕深度与路径展示", C.bamboo],
    ["苏州织锦", "经纬显花、锦纹、织造结构", "纹样拆解；经纬组织动态模拟", C.blue],
    ["明清刺绣", "针法、线色、花鸟人物纹样", "针脚路径追踪；局部高清放大", C.red],
  ];
  data.forEach((d, i) => {
    const y = 1.78 + i * 1.23;
    slide = s;
    s.addShape(pptx.ShapeType.rect, { x: 0.78, y, w: 11.75, h: 0.92, fill: { color: C.panel }, line: { color: C.line } });
    s.addShape(pptx.ShapeType.rect, { x: 0.78, y, w: 0.12, h: 0.92, fill: { color: d[3] }, line: { color: d[3] } });
    s.addText(d[0], { x: 1.05, y: y + 0.25, w: 1.45, h: 0.22, fontSize: 13, bold: true, color: C.ink, margin: 0 });
    s.addText(d[1], { x: 3.05, y: y + 0.18, w: 3.2, h: 0.34, fontSize: 10.2, color: C.sub, fit: "shrink", margin: 0 });
    s.addText(d[2], { x: 6.75, y: y + 0.18, w: 4.55, h: 0.34, fontSize: 10.2, color: C.ink, fit: "shrink", margin: 0 });
  });
  label(s, "MATERIAL  /  TECHNIQUE  /  INTERACTION", 0.78, 6.65, C.red);
  footer(s, 3);
}

// 4 Concept
{
  const s = pptx.addSlide(); bg(s); header(s, 4, "CONCEPT", "总概念：一座可交互的“工艺纹理实验室”");
  imageFrame(s, IMG.cover, 7.05, 1.78, 5.15, 3.15);
  s.addText("核心概念", { x: 0.92, y: 1.88, w: 1.2, h: 0.22, fontSize: 12, bold: true, color: C.red, margin: 0 });
  s.addText("把传统工艺从“静态展品”转化为“可被触摸、拆解、生成和带走的体验”。", { x: 0.92, y: 2.26, w: 5.3, h: 0.56, fontSize: 18, bold: true, color: C.ink, fit: "shrink", margin: 0 });
  bullet(s, [
    "观众通过交互屏选择颜色、纹样和材质，生成个人化工艺图谱。",
    "展陈以材料质感为入口，用数字技术解释背后的工艺逻辑。",
    "每个模块都保留传统审美，不把非遗做成单纯科技噱头。",
    "最终形成“看见传统、理解传统、再创造传统”的学习路径。",
  ], 1.0, 3.25, 5.35, C.red);
  card(s, 7.05, 5.25, 5.15, 0.92, "体验关键词", "材料感 · 工艺层次 · 数字解析 · 观众共创 · 可传播成果", C.gold);
  footer(s, 4);
}

// 5 Exhibition route
{
  const s = pptx.addSlide(); bg(s); header(s, 5, "EXPERIENCE ROUTE", "展陈叙事与空间动线");
  processLine(s, ["入口：传统色引导", "材料样本墙", "AI 配色交互屏", "竹刻扫描装置", "织锦刺绣解析台", "生成个人展签"], 0.75, 2.0, 11.85);
  const zones = [
    ["A 色彩入口", "从漆红、竹青、靛蓝、金线等传统色建立第一印象。"],
    ["B 工艺解析", "通过放大、剖面、扫描和路径动画解释工艺生成方式。"],
    ["C 共创输出", "观众生成个人纹样/配色卡，可用于海报或社交分享。"],
  ];
  zones.forEach((z, i) => card(s, 1.0 + i * 3.95, 3.85, 3.25, 1.35, z[0], z[1], [C.red, C.blue, C.gold][i]));
  imageFrame(s, IMG.cover, 1.0, 5.62, 11.2, 0.78);
  footer(s, 5);
}

// 6 Module 1
{
  const s = pptx.addSlide(); bg(s); header(s, 6, "MODULE 01", "传统色 AI 配色交互屏");
  imageFrame(s, IMG.color, 0.72, 1.72, 6.3, 3.55);
  card(s, 7.45, 1.78, 4.75, 1.05, "方案文本", "观众从大漆、织锦、刺绣图像中提取传统色，AI 根据色相关系生成展览海报、纹样卡与配色建议。", C.red);
  bullet(s, [
    "输入：展品照片、纹样局部、用户选择的情绪关键词。",
    "处理：色彩提取、近似传统色匹配、配色比例推荐。",
    "输出：个人传统色卡、工艺灵感板、可下载电子展签。",
    "价值：把“颜色好看”转化为“颜色为何这样搭配”的学习体验。",
  ], 7.55, 3.18, 4.4, C.red);
  swatch(s, 0.95, 5.72, ["5A1612", "8E2C1C", "B6905C", "153F68", "2F4A3B", "C59A38"], ["乌漆", "朱砂", "竹黄", "靛青", "墨绿", "金"]);
  footer(s, 6);
}

// 7 Module 2
{
  const s = pptx.addSlide(); bg(s); header(s, 7, "MODULE 02", "嘉定竹刻数字扫描展示装置");
  imageFrame(s, IMG.bamboo, 6.42, 1.72, 5.85, 3.55);
  card(s, 0.85, 1.78, 4.9, 1.05, "方案文本", "以竹刻器物为核心，利用数字扫描和深度图把“以刀代笔”的痕迹转化为可观察、可比较的视觉数据。", C.bamboo);
  bullet(s, [
    "扫描光带沿竹刻表面移动，实时生成刀痕深浅图。",
    "屏幕展示线刻、浮雕、留青等不同刀法的局部差异。",
    "观众可滑动时间轴，查看从草图到刻制完成的工艺过程。",
    "适合解决竹刻细节肉眼不易看清、工序难以理解的问题。",
  ], 0.95, 3.22, 4.9, C.bamboo);
  processLine(s, ["实物放置", "结构光扫描", "刀痕建模", "局部放大", "工艺讲解"], 0.92, 5.82, 11.15);
  footer(s, 7);
}

// 8 Module 3
{
  const s = pptx.addSlide(); bg(s); header(s, 8, "MODULE 03", "苏州织锦与明清刺绣纹样解析台");
  imageFrame(s, IMG.textile, 0.72, 1.72, 6.25, 3.55);
  card(s, 7.42, 1.78, 4.78, 1.05, "方案文本", "通过高清纹样采集、经纬结构拆解与针法路径动画，让观众理解织锦和刺绣的“图案如何被制造出来”。", C.blue);
  bullet(s, [
    "织锦：显示经线、纬线、显花组织与纹样重复单元。",
    "刺绣：显示针脚方向、线色叠加和局部明暗塑形。",
    "交互：点击纹样局部，切换“整体图案 / 结构层 / 工艺层”。",
    "输出：生成一张个人纹样解析卡，附带材料与工艺说明。",
  ], 7.52, 3.18, 4.5, C.blue);
  footer(s, 8);
}

// 9 Interaction architecture
{
  const s = pptx.addSlide(); bg(s); header(s, 9, "INTERACTION FLOW", "信息架构与交互流程");
  const rows = [
    ["观众动作", "触摸选择工艺", "放大局部", "拖动拆解层", "生成方案", "保存分享"],
    ["系统反馈", "显示材料故事", "呈现高清纹理", "播放工艺动画", "AI 生成色卡/纹样", "生成电子展签"],
    ["学习结果", "知道看什么", "看清细节", "理解工序", "形成个人表达", "带走记忆点"],
  ];
  rows.forEach((r, row) => {
    const y = 1.85 + row * 1.33;
    r.forEach((cell, col) => {
      const x = 0.72 + col * 2.05;
      const accent = row === 0 ? C.red : row === 1 ? C.blue : C.gold;
      slide = s;
      s.addShape(pptx.ShapeType.rect, { x, y, w: 1.75, h: 0.84, fill: { color: col === 0 ? "F0E4D1" : C.panel }, line: { color: C.line } });
      s.addText(cell, { x: x + 0.12, y: y + 0.26, w: 1.5, h: 0.18, fontSize: col === 0 ? 9.5 : 8.6, bold: col === 0, color: col === 0 ? accent : C.ink, align: "center", fit: "shrink", margin: 0 });
    });
  });
  card(s, 1.0, 6.15, 11.1, 0.62, "设计原则", "每一步交互都必须对应明确的学习收获：不是为了“能点”，而是为了让观众看懂材料、工序与审美。", C.red);
  footer(s, 9);
}

// 10 Spatial and equipment
{
  const s = pptx.addSlide(); bg(s); header(s, 10, "SYSTEM DESIGN", "空间布局与设备系统");
  s.addShape(pptx.ShapeType.rect, { x: 0.9, y: 1.78, w: 5.6, h: 4.1, fill: { color: C.panel }, line: { color: C.line } });
  const zones = [
    ["入口屏", 1.2, 2.05, 1.1, 0.55, C.red],
    ["材料墙", 2.65, 2.05, 1.4, 0.55, C.bamboo],
    ["AI配色屏", 4.55, 2.05, 1.45, 0.55, C.blue],
    ["竹刻扫描台", 1.25, 3.45, 1.75, 0.75, C.bamboo],
    ["织锦刺绣台", 3.65, 3.45, 1.9, 0.75, C.red],
    ["生成区", 2.65, 5.0, 1.45, 0.55, C.gold],
  ];
  zones.forEach(z => {
    s.addShape(pptx.ShapeType.rect, { x: z[1], y: z[2], w: z[3], h: z[4], fill: { color: z[5], transparency: 8 }, line: { color: z[5] } });
    s.addText(z[0], { x: z[1] + 0.05, y: z[2] + z[4] / 2 - 0.08, w: z[3] - 0.1, h: 0.15, fontSize: 8.2, bold: true, color: "FFFFFF", align: "center", margin: 0 });
  });
  bullet(s, [
    "硬件：大尺寸触控屏、结构光/摄影测量扫描、展柜灯光、平板导览。",
    "软件：纹理数据库、传统色提取模型、AR 分层展示、电子展签生成。",
    "数据：材料图像、工艺步骤、纹样矢量化文件、观众交互记录。",
    "维护：所有演示内容可通过后台替换，适合后续换展和课程展示。",
  ], 7.05, 1.95, 4.85, C.blue);
  footer(s, 10);
}

// 11 Visual system
{
  const s = pptx.addSlide(); bg(s); header(s, 11, "VISUAL SYSTEM", "视觉系统：传统质感与数字界面的平衡");
  label(s, "COLOR PALETTE", 0.9, 1.85, C.red);
  swatch(s, 0.9, 2.25, ["5A1612", "9E2B20", "B6905C", "153F68", "496B5A", "B98A2E", "F6F0E5"], ["漆黑", "朱红", "竹黄", "靛蓝", "青绿", "金线", "纸色"]);
  const principles = [
    ["版式", "采用博物馆展签式留白，避免信息堆满。"],
    ["材质", "以漆面反光、竹材纹理、织物经纬和绣线肌理作为视觉母题。"],
    ["界面", "数字 UI 使用细线、色块和局部放大窗口，降低科技感的压迫。"],
    ["字体", "标题稳重，正文清晰，英文只做辅助标识，避免喧宾夺主。"],
  ];
  principles.forEach((p, i) => card(s, 0.9 + (i % 2) * 5.75, 3.25 + Math.floor(i / 2) * 1.25, 5.05, 0.92, p[0], p[1], [C.red, C.blue, C.gold, C.jade][i]));
  footer(s, 11);
}

// 12 Storyboard
{
  const s = pptx.addSlide(); bg(s); header(s, 12, "STORYBOARD", "观众体验脚本：从观看到共创");
  const scenes = [
    ["进入展厅", "被材料墙和传统色引导，建立对四类工艺的整体印象。"],
    ["触摸选择", "在交互屏中选择感兴趣的颜色、纹样或工艺材料。"],
    ["拆解理解", "观看扫描、针法、经纬和漆层的分解演示。"],
    ["生成带走", "得到个人色卡 / 纹样解析卡 / 电子展签。"],
  ];
  scenes.forEach((sc, i) => {
    const x = 0.78 + i * 3.05;
    card(s, x, 2.0, 2.55, 2.15, `0${i + 1} ${sc[0]}`, sc[1], [C.red, C.bamboo, C.blue, C.gold][i]);
    s.addShape(pptx.ShapeType.arc, { x: x + 0.55, y: 4.55, w: 1.2, h: 0.8, line: { color: [C.red, C.bamboo, C.blue, C.gold][i], width: 1.2, dash: "dash" }, fill: { color: C.panel, transparency: 100 } });
  });
  imageFrame(s, IMG.cover, 1.15, 5.35, 10.9, 0.85);
  footer(s, 12);
}

// 13 Summary
{
  const s = pptx.addSlide(); bg(s); header(s, 13, "VALUE & REFERENCES", "方案价值与参考资料");
  const values = [
    ["文化价值", "让传统工艺的材料美、工序美和纹样美被更清晰地理解。"],
    ["教育价值", "适合课堂展示、博物馆研学、非遗体验课程与线上传播。"],
    ["设计价值", "把 AI、扫描、AR 和交互屏转化为服务内容理解的工具。"],
    ["传播价值", "观众生成的色卡和纹样卡可作为二次传播素材。"],
  ];
  values.forEach((v, i) => card(s, 0.8 + (i % 2) * 5.85, 1.78 + Math.floor(i / 2) * 1.3, 5.15, 0.95, v[0], v[1], [C.red, C.blue, C.gold, C.jade][i]));
  label(s, "REFERENCES", 0.9, 5.05, C.red);
  bullet(s, [
    "中国非物质文化遗产网：中国非物质文化遗产数字博物馆相关项目资料。",
    "苏州非物质文化遗产信息网：宋锦织造技艺、苏绣相关资料。",
    "上海市文旅推广网：嘉定竹刻相关资料。",
    "本方案演示图片由 AI 生成，用于课程设计方案表达，不代表真实展馆现场。",
  ], 0.95, 5.42, 10.8, C.red);
  footer(s, 13);
}

pptx.writeFile({ fileName: FILE });
