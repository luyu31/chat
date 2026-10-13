#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把网页版资源整理进 APK 的 assets/web，并做两件事：
   1. 把关键 CDN 依赖（localforage / jszip / Font Awesome / Tabler 图标）本地化，断网也不缺图标；
   2. 在 index.html 最前面注入原生桥接脚本。
"""
import os
import re
import shutil
import sys
import urllib.request
import urllib.parse

SRC = "/workspace"
DST = "/workspace/.build/milkchat/assets/web"
SHIM_SRC = "/workspace/.build/native-shim.js"
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"

URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)")


def fetch(url, binary=True):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "*/*",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def copy_tree():
    if os.path.exists(DST):
        shutil.rmtree(DST)
    os.makedirs(DST, exist_ok=True)
    shutil.copy2(os.path.join(SRC, "index.html"), os.path.join(DST, "index.html"))
    for d in ("css", "js", "assets"):
        shutil.copytree(os.path.join(SRC, d), os.path.join(DST, d))
    shutil.copy2(SHIM_SRC, os.path.join(DST, "native-shim.js"))
    print("[copy] 网页资源已复制到 assets/web")


def vendor_css(remote_css_url, slot):
    """下载一份 CSS 及其引用的字体文件，保持相对目录结构"""
    slot_root = os.path.join(DST, "vendor", slot)
    if os.path.exists(slot_root):
        shutil.rmtree(slot_root)
    os.makedirs(slot_root, exist_ok=True)

    parsed = urllib.parse.urlsplit(remote_css_url)
    base_dir = parsed._replace(path=parsed.path.rsplit("/", 1)[0] + "/").geturl()
    rel_css = parsed.path.lstrip("/")

    css_text = fetch(remote_css_url, binary=False)
    css_local = os.path.join(slot_root, rel_css)
    os.makedirs(os.path.dirname(css_local), exist_ok=True)

    missing = []

    def repl(m):
        raw = m.group(2).strip()
        if raw.startswith(("data:", "#", "http://", "https://", "//")):
            return m.group(0)
        target = urllib.parse.urljoin(base_dir, raw)
        path_part = urllib.parse.urlsplit(target).path
        local_rel = urllib.parse.unquote(path_part.lstrip("/"))
        local_abs = os.path.join(slot_root, local_rel)
        try:
            if not os.path.exists(local_abs):
                os.makedirs(os.path.dirname(local_abs), exist_ok=True)
                with open(local_abs, "wb") as f:
                    f.write(fetch(target))
            return "url(%s)" % raw
        except Exception as e:  # noqa: BLE001
            missing.append((raw, str(e)))
            return m.group(0)

    css_text = URL_RE.sub(repl, css_text)
    with open(css_local, "w", encoding="utf-8") as f:
        f.write(css_text)

    if missing:
        print("[warn] %s 有 %d 个引用未下载" % (slot, len(missing)))
    print("[vendor] %s -> %s" % (slot, os.path.relpath(css_local, DST)))
    return os.path.relpath(css_local, DST).replace(os.sep, "/")


def vendor_js(remote_url, local_rel):
    local_abs = os.path.join(DST, local_rel)
    os.makedirs(os.path.dirname(local_abs), exist_ok=True)
    with open(local_abs, "wb") as f:
        f.write(fetch(remote_url))
    print("[vendor] %s -> %s" % (local_rel, remote_url))
    return local_rel


def main():
    copy_tree()

    fa_css = vendor_css(
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
        "fontawesome")
    tabler_css = vendor_css(
        "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css",
        "tabler")
    lf_js = vendor_js(
        "https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js",
        "vendor/localforage/localforage.min.js")
    zip_js = vendor_js(
        "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
        "vendor/jszip/jszip.min.js")

    # ---- 改写 index.html ----
    idx = os.path.join(DST, "index.html")
    with open(idx, "r", encoding="utf-8") as f:
        html = f.read()

    html = html.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js", lf_js)
    html = html.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", zip_js)
    html = html.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css", fa_css)
    html = html.replace(
        "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css", tabler_css)

    # 注入原生桥接脚本（放在最前面，保证早于页面自身脚本执行）
    marker = "<head>"
    inject = ('<head>\n    <script src="native-shim.js"></script>')
    if inject not in html:
        if marker in html:
            html = html.replace(marker, inject, 1)
        else:
            html = '<script src="native-shim.js"></script>\n' + html

    with open(idx, "w", encoding="utf-8") as f:
        f.write(html)

    ok = ("native-shim.js" in html and lf_js in html and fa_css in html
          and os.path.isfile(os.path.join(DST, "native-shim.js")))
    print("[index.html] 本地化改写 %s" % ("OK" if ok else "失败"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())