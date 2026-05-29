![主页预览](/主页预览.png)

# iBoat网盘

一个自托管文件目录索引网盘。文件存放在服务器本地目录，前端负责展示目录、文件、面包屑、下载入口和加密目录。

作者：BOATZHOU

## 文档

详细部署、Nginx 大文件下载优化、安全配置、systemd/PM2 常驻运行、HTTPS、品牌和图标手动修改说明，请看：

```text
DEPLOY.md
```

## 启动

```powershell
npm start
```

默认访问：

```text
http://localhost:3000
```

目录会使用干净路径，例如：

```text
http://localhost:3000/动漫/二级文件夹
```

## 使用自己的存储目录

```powershell
$env:PAN_ROOT="D:\pan-files"
$env:PAN_SECRET="换成一段随机长字符串"
npm start
```

Linux 示例：

```bash
HOST=127.0.0.1 \
PAN_ROOT=/data/iboat-pan/storage \
PAN_SECRET='换成一段随机长字符串' \
npm start
```

默认只监听 `127.0.0.1`，推荐配合同机 Nginx 反向代理使用。只有在 Node 和反向代理不在同一台机器时，才需要显式设置：

```bash
HOST=0.0.0.0 npm start
```

## Nginx 大文件下载优化

默认情况下，文件由 Node.js 直接读取并输出。小文件没有问题，但大文件或多人同时下载时，推荐开启 Nginx `X-Accel-Redirect`，让 Node 只负责鉴权，实际文件传输交给 Nginx。

启动 Node 时开启：

```bash
PAN_ROOT=/data/iboat-pan/storage \
PAN_SECRET='换成一段随机长字符串' \
HOST=127.0.0.1 \
PAN_X_ACCEL=1 \
PAN_X_ACCEL_PREFIX=/_iboat_files/ \
npm start
```

Nginx 中需要配置同样的内部路径：

```nginx
location /_iboat_files/ {
    internal;
    alias /data/iboat-pan/storage/;
}
```

重点：

- `PAN_ROOT` 必须和 Nginx `alias` 指向同一个真实文件目录。
- `PAN_X_ACCEL_PREFIX` 必须和 Nginx 的 `location` 路径一致。
- `internal` 必须保留，避免用户绕过 Node 鉴权直接访问文件。
- Node 默认监听 `127.0.0.1`，公网只暴露 Nginx 的 `80/443`。
- 完整示例在 `deploy/nginx-iboat-pan.conf`。

## 安全边界

后端会统一拒绝隐藏路径，例如 `.env`、`.git/config`、`folder/.secret.txt`。

后端还会使用 `realpath` 校验真实路径，防止存储目录中的软链接逃逸到 `PAN_ROOT` 之外。

生产环境建议：

- `PAN_ROOT` 使用独立目录，不要指向项目根目录。
- 不要把 `.env`、配置文件、数据库文件放进存储目录。
- Node 端口只监听 `127.0.0.1`，由 Nginx 反向代理访问。
- Nginx 的 `/_iboat_files/` 必须使用 `internal`。

## 配置

编辑 `config/site.json`：

```json
{
  "title": "iBoat网盘",
  "channelLabel": "关注TG频道",
  "channelUrl": "https://t.me/your_channel",
  "protected": {
    "加密文件夹": {
      "password": "123456"
    }
  }
}
```

`protected` 的 key 是相对存储根目录的文件夹路径。生产环境建议通过服务器权限、反向代理和强密码一起保护敏感目录。
