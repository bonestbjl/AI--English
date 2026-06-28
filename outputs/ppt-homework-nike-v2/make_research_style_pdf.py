from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
import os
import textwrap

OUT_DIR = "/Users/baojiale/Documents/英语趣味学习/outputs/ppt-homework-nike-v2"
HERO = os.path.join(OUT_DIR, "assets/style-preview-research-board.png")
PDF_PATH = os.path.join(OUT_DIR, "综合影像调研报告_研究看板风_Nike_You_Cant_Stop_Us.pdf")

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
FONT = "STSong-Light"
PAGE = (13.333 * inch, 7.5 * inch)
W, H = PAGE

C = {
    "paper": HexColor("#F5F0E6"),
    "cream": HexColor("#FFFDF7"),
    "ink": HexColor("#151515"),
    "sub": HexColor("#5F625F"),
    "red": HexColor("#A92821"),
    "blue": HexColor("#174B84"),
    "line": HexColor("#D7CFC0"),
    "grid": HexColor("#E6DED0"),
    "white": HexColor("#FFFFFF"),
    "dark": HexColor("#252525"),
}

def u(v):
    return v * inch

def set_font(c, size):
    c.setFont(FONT, size)

def draw_text(c, value, x, y, size=12, color=None, width_chars=None, leading=None, center=False):
    c.setFillColor(color or C["ink"])
    set_font(c, size)
    lines = []
    for para in str(value).split("\n"):
        if width_chars:
            lines.extend(textwrap.wrap(para, width_chars) or [""])
        else:
            lines.append(para)
    leading = leading or size * 1.36
    for i, line in enumerate(lines):
        yy = y - i * leading
        if center:
            c.drawCentredString(x, yy, line)
        else:
            c.drawString(x, yy, line)

def draw_latin(c, value, x, y, size=12, color=None):
    c.setFillColor(color or C["ink"])
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, value)

def background(c):
    c.setFillColor(C["paper"])
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setStrokeColor(C["grid"])
    c.setLineWidth(0.25)
    for i in range(1, 27):
        x = u(0.35 + i * 0.5)
        c.line(x, u(0.45), x, H - u(0.45))
    for i in range(1, 14):
        y = u(0.35 + i * 0.5)
        c.line(u(0.45), y, W - u(0.45), y)

def header(c, no, section, title):
    draw_text(c, f"{no:02d}", u(0.62), H - u(0.56), 12, C["red"])
    c.setStrokeColor(C["red"]); c.setLineWidth(2)
    c.line(u(1.18), H - u(0.50), u(2.53), H - u(0.50))
    draw_text(c, section, u(2.65), H - u(0.55), 8.2, C["sub"])
    draw_text(c, title, u(0.62), H - u(1.08), 21, C["ink"])
    c.setStrokeColor(C["line"]); c.setLineWidth(1)
    c.line(u(0.62), H - u(1.42), W - u(0.66), H - u(1.42))

def footer(c, no):
    draw_text(c, f"综合影像实践调研报告 · Nike《You Can't Stop Us》 · {no:02d}", u(0.62), u(0.32), 7.2, C["sub"])
    c.setStrokeColor(C["ink"]); c.setLineWidth(1.1)
    c.line(W - u(2.28), u(0.28), W - u(0.62), u(0.28))

def label(c, text, x, y, color=None):
    color = color or C["red"]
    c.setFillColor(color)
    c.rect(x, y - 2, 28, 3, fill=1, stroke=0)
    draw_text(c, text, x + 36, y - 3, 8.5, C["sub"])

def card(c, x, y, w, h, title, body, accent=None):
    accent = accent or C["red"]
    c.setFillColor(C["cream"]); c.setStrokeColor(C["line"]); c.setLineWidth(0.8)
    c.rect(x, y, w, h, fill=1, stroke=1)
    c.setFillColor(accent); c.rect(x, y, 5, h, fill=1, stroke=0)
    draw_text(c, title, x + 16, y + h - 20, 11.5, C["ink"])
    draw_text(c, body, x + 16, y + h - 44, 9.2, C["sub"], width_chars=max(10, int(w / 13)), leading=12.5)

def bullets(c, items, x, y, wchars=31, accent=None):
    accent = accent or C["red"]
    for i, item in enumerate(items):
        yy = y - i * u(0.62)
        c.setFillColor(accent)
        c.rect(x, yy - 1, 6, 6, fill=1, stroke=0)
        draw_text(c, item, x + 18, yy + 2, 10.4, C["ink"], width_chars=wchars, leading=14)

def frame(c, x, y, w, h, fill="#F2EEE5"):
    c.setFillColor(HexColor(fill)); c.setStrokeColor(C["line"]); c.setLineWidth(0.8)
    c.rect(x, y, w, h, fill=1, stroke=1)

def split_diagram(c, x, y, w, h):
    frame(c, x, y, w, h)
    c.setFillColor(HexColor("#DAD7D0")); c.rect(x + 8, y + 8, w / 2 - 9, h - 16, fill=1, stroke=0)
    c.setFillColor(HexColor("#252525")); c.rect(x + w / 2, y + 8, w / 2 - 8, h - 16, fill=1, stroke=0)
    c.setFillColor(C["red"]); c.rect(x + w * 0.2, y + 8, 52, h - 16, fill=1, stroke=0)
    c.setFillColor(C["blue"]); c.rect(x + w * 0.78, y + 8, 24, h - 16, fill=1, stroke=0)
    c.setStrokeColor(C["white"]); c.setLineWidth(1.2)
    c.line(x + w / 2, y + 8, x + w / 2, y + h - 8)
    c.setStrokeColor(C["red"]); c.setLineWidth(1)
    c.arc(x + 55, y + 70, x + 210, y + 175, 210, 120)
    c.setStrokeColor(C["ink"]); c.setDash(3, 3)
    c.line(x + 165, y + 82, x + w - 55, y + h - 72)
    c.setDash()

def film_strip(c, x, y, w, h, n=10):
    frame(c, x, y, w, h, "#EFE8DC")
    gap = 4
    cell = (w - 18 - (n - 1) * gap) / n
    for i in range(n):
        cx = x + 9 + i * (cell + gap)
        c.setFillColor(HexColor("#C8C5BD") if i % 2 else HexColor("#DCD8CF"))
        c.rect(cx, y + 8, cell, h - 16, fill=1, stroke=0)
        c.setStrokeColor(C["red"] if i % 3 else C["blue"]); c.setLineWidth(0.6)
        c.line(cx + cell * 0.2, y + 11, cx + cell * 0.78, y + h - 12)

slides = [
    ("RESEARCH OBJECT", "作业要求与选题说明", [
        ("作业任务", "选择 1 部具有代表性的“综合影像”作品，完成图文并茂的调研报告。"),
        ("本报告选题", "Nike 广告短片《You Can't Stop Us》，发布于 2020 年。"),
        ("选择理由", "作品融合广告、体育影像、素材拼贴、分屏剪辑与社会情绪表达。"),
        ("报告结构", "从基本信息、创作背景、技术手法、影像语言与审美特点四部分展开。"),
    ], "cards"),
    ("PART 01 · BASIC INFO", "作品基本信息", [
        ("作品名称", "You Can't Stop Us"),
        ("作品类型", "广告短片 / 体育影像 / 分屏蒙太奇"),
        ("发布年份", "2020 年"),
        ("品牌", "Nike"),
        ("创意代理", "Wieden+Kennedy Portland"),
        ("旁白", "Megan Rapinoe"),
    ], "facts"),
    ("CONTENT OVERVIEW", "作品内容概述", [
        "短片把不同运动员、不同项目、不同场景的影像片段重新拼接。",
        "左右两半画面经常来自不同素材，却在动作、姿态、构图上形成连接。",
        "作品传达“困难不能阻止运动与人的连接”的体育精神。",
        "它讲述的不是一个人的故事，而是群体共同面对困境的故事。",
    ], "bullets"),
    ("PART 02 · BACKGROUND", "创作背景：疫情语境中的体育停摆", [
        "2020 年全球公共卫生危机影响体育赛事、训练与日常生活。",
        "许多线下比赛暂停，人与人之间的连接感被削弱。",
        "Nike 在此背景下推出短片，用体育影像回应共同的不确定情绪。",
        "作品把体育精神与社会团结联系起来，形成更广泛的公共表达。",
    ], "bullets"),
    ("COMMUNICATION PURPOSE", "创作目的：从商业广告到情感动员", [
        ("表达核心", "体育不会因为困难而停止，人的连接也不会被完全切断。"),
        ("品牌精神", "强化 Nike 一贯强调的坚持、突破、团结与行动。"),
        ("情绪共鸣", "用真实运动影像唤起观众对赛事、身体与共同体的记忆。"),
        ("传播策略", "减少直接商品呈现，把品牌放进更大的社会情绪叙事中。"),
    ], "cards"),
    ("PART 03 · TECHNIQUE", "技术手法一：分屏剪辑", [
        "作品最突出的形式是左右分屏，将两个不同镜头拼成一个连续动作。",
        "剪辑依据包括身体姿态、运动方向、画面重心和动作速度。",
        "中线既是视觉缝合线，也是作品主题的隐喻：分离中仍然连接。",
        "这种分屏不是装饰，而是把技术形式变成意义表达。",
    ], "tech"),
    ("MATERIAL MATCHING", "技术手法二：素材拼贴与匹配剪辑", [
        "作品使用大量不同来源的体育素材，包含不同项目、人物和场景。",
        "剪辑重点不是简单堆砌，而是寻找动作之间的相似性与连续性。",
        "素材重组后，单个比赛片段被转化为更大的集体叙事。",
        "不同影像之间的差异被保留，使作品同时具有多样性与统一感。",
    ], "bullets"),
    ("SOUND & RHYTHM", "技术手法三：声音、旁白与节奏", [
        "Megan Rapinoe 的旁白推动短片从困境叙述转向希望表达。",
        "音乐和剪辑节奏逐步加快，情绪从低沉转为振奋。",
        "旁白不是简单解释画面，而是把体育动作提升为社会情绪。",
        "声音、动作和剪辑点共同构成作品的情绪曲线。",
    ], "bullets"),
    ("PART 04 · IMAGE LANGUAGE", "影像语言分析", [
        ("对称", "左右画面形成镜像关系，使不同场景看起来属于同一视觉空间。"),
        ("并置", "不同人物、项目、国家和场景同时出现，形成跨边界的比较。"),
        ("连续", "动作轨迹被剪成流畅的身体线条，强化运动的流动感。"),
        ("象征", "体育动作被转化为“不停止”的精神象征，而不只是比赛记录。"),
    ], "cards"),
    ("AESTHETIC VALUE", "审美特点与作品价值", [
        "视觉上具有强烈的设计感，分屏结构带来秩序和形式美。",
        "真实体育素材保留纪实质感，让情绪表达更可信。",
        "作品的情绪表达克制但有力量，没有依赖过度煽情的画面。",
        "它把商业广告提升为具有公共情绪与审美表达的综合影像作品。",
    ], "bullets"),
    ("SUMMARY", "总结与个人评价", [
        "《You Can't Stop Us》是一部典型的综合影像作品。",
        "它综合了广告、体育、纪录素材、剪辑技术和公共议题。",
        "最大亮点是让“分屏形式”服务于“团结主题”。",
        "对综合影像实践的启发：技术不能只是炫技，而要服务主题和情感表达。",
    ], "summary"),
]

def draw_content_page(c, no, section, title, content, kind):
    background(c); header(c, no, section, title)
    if kind == "cards":
        split_diagram(c, u(0.72), H - u(4.95), u(4.85), u(3.25))
        for i, (t, b) in enumerate(content):
            x = u(6.02 + (i % 2) * 3.05)
            y = H - u(3.08 + (i // 2) * 1.62)
            card(c, x, y, u(2.72), u(1.26), t, b, C["blue"] if i % 2 else C["red"])
        film_strip(c, u(0.72), u(1.18), u(11.9), u(0.62))
    elif kind == "facts":
        split_diagram(c, u(0.72), H - u(5.32), u(5.25), u(3.5))
        for i, (k, v) in enumerate(content):
            y = H - u(1.95 + i * 0.65)
            draw_text(c, k, u(6.38), y, 10, C["blue"] if i % 2 else C["red"])
            draw_text(c, v, u(7.92), y, 11, C["ink"], width_chars=25)
            c.setStrokeColor(C["line"]); c.setLineWidth(0.7)
            c.line(u(6.38), y - 13, u(11.78), y - 13)
        film_strip(c, u(1.12), u(0.98), u(10.85), u(0.55), n=12)
    elif kind == "tech":
        split_diagram(c, u(0.72), H - u(5.57), u(6.1), u(3.75))
        bullets(c, content, u(7.35), H - u(2.06), 24, C["red"])
        label(c, "MATCHING LOGIC", u(0.9), u(1.43), C["blue"])
        draw_text(c, "身体姿态 / 运动方向 / 画面重心 / 动作速度", u(2.58), u(1.41), 9.2, C["sub"])
    else:
        split_diagram(c, u(7.35), H - u(4.96), u(4.85), u(3.08))
        bullets(c, content, u(0.95), H - u(2.06), 31, C["blue"] if no % 2 else C["red"])
        if kind == "summary":
            label(c, "REFERENCES", u(7.35), u(1.57), C["blue"])
            draw_text(c, "Wieden+Kennedy 项目页；Colossal / Digital Synopsis / Musicbed 制作分析文章；课堂作业照片。", u(7.35), u(1.22), 9, C["sub"], width_chars=34)
        else:
            card(c, u(0.95), u(1.25), u(5.8), u(0.72), "分析结论", "不同素材通过剪辑关系被重新组织，形成新的叙事、情绪与审美秩序。", C["blue"] if no % 2 else C["red"])
    footer(c, no)
    c.showPage()

def make_pdf():
    c = canvas.Canvas(PDF_PATH, pagesize=PAGE)
    # Cover
    if os.path.exists(HERO):
        c.drawImage(ImageReader(HERO), 0, 0, width=W, height=H)
    c.setFillColor(HexColor("#F5F0E6")); c.setFillAlpha(0.18)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillAlpha(1)
    c.setFillColor(C["cream"]); c.setStrokeColor(C["line"])
    c.rect(u(0.72), u(0.88), u(4.85), u(5.9), fill=1, stroke=1)
    label(c, "综合影像实践 · 小作业1", u(1.02), H - u(1.15), C["red"])
    draw_latin(c, "Nike", u(1.02), H - u(1.92), 25, C["ink"])
    draw_latin(c, "You Can't Stop Us", u(1.02), H - u(2.45), 20, C["ink"])
    draw_text(c, "综合影像作品调研报告", u(1.02), H - u(3.05), 18, C["ink"])
    c.setStrokeColor(C["ink"]); c.setLineWidth(1.1); c.line(u(1.02), H - u(3.46), u(4.97), H - u(3.46))
    draw_text(c, "分屏剪辑中的体育精神与公共情绪表达", u(1.02), H - u(3.95), 13, C["sub"], width_chars=18)
    draw_text(c, "报告聚焦作品的基本信息、创作背景、技术手法与影像语言，分析它如何把大量异质素材组织成有审美秩序的综合影像。", u(1.02), H - u(4.75), 10.3, C["ink"], width_chars=24, leading=15)
    draw_text(c, "12-page research deck", u(1.02), u(1.25), 7.5, C["sub"])
    c.showPage()
    for i, slide in enumerate(slides, start=2):
        draw_content_page(c, i, *slide)
    c.save()

if __name__ == "__main__":
    make_pdf()
    print(PDF_PATH)
