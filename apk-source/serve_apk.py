#!/usr/bin/env python3
"""为 /workspace 下的 APK 提供下载服务的简易 HTTP 服务。"""
import http.server
import socketserver
import os
import urllib.parse

PORT = int(os.environ.get("PORT", "8080"))
ROOT = "/workspace"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 对 apk 文件强制下载
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def guess_type(self, path):
        if path.lower().endswith(".apk"):
            return "application/vnd.android.package-archive"
        return super().guess_type(path)

    def do_GET(self):
        # 支持中文路径
        path = urllib.parse.unquote(self.path)
        if path == "/" or path == "":
            # 列出可下载文件
            items = []
            for f in sorted(os.listdir(ROOT)):
                fp = os.path.join(ROOT, f)
                if os.path.isfile(fp) and (f.endswith(".apk")):
                    size_mb = os.path.getsize(fp) / 1024 / 1024
                    items.append(f'<li><a href="{urllib.parse.quote(f)}">⬇ {f}</a> <span style="color:#888">({size_mb:.1f} MB)</span></li>')
            body = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>传讯 APK 下载</title>
<style>body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f14;color:#e8e8e8;margin:0;padding:40px 20px;display:flex;justify-content:center;}}
.card{{max-width:520px;width:100%;background:#1a1a24;border-radius:16px;padding:32px;box-shadow:0 8px 32px rgba(0,0,0,.4);}}
h1{{color:#c5a47e;margin:0 0 8px;font-size:22px;}}
.sub{{color:#888;font-size:13px;margin:0 0 24px;}}
ul{{list-style:none;padding:0;margin:0;}}
li{{margin:12px 0;}}
a{{color:#c5a47e;text-decoration:none;font-size:16px;display:inline-block;padding:12px 16px;background:#26262f;border-radius:10px;transition:.2s;}}
a:hover{{background:#33333d;}}
.tip{{margin-top:24px;color:#666;font-size:12px;line-height:1.6;}}</style></head>
<body><div class="card"><h1>📱 传讯 APK 下载</h1><p class="sub">点击下方链接下载安装包,然后传到安卓手机安装。</p>
<ul>{''.join(items) if items else '<li style="color:#888">暂无可下载的 APK</li>'}</ul>
<p class="tip">💡 安装时如提示"未知来源",请在手机设置里允许安装该应用。<br>此为 debug 签名版本,仅用于自用测试。</p>
</div></body></html>"""
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

if __name__ == "__main__":
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Download server on http://0.0.0.0:{PORT}")
        httpd.serve_forever()
