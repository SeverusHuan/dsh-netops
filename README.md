# dsh-netops

Network device inspection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
只读巡检网络设备：CPU、内存、风扇、电源、温度、磁盘、运行时长，SSH 与 Telnet 都支持，每次巡检留一份可追溯的报告。

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)

## 它解决什么

在对话框里说一句「巡检全部设备」，agent 调用插件跑一组只读命令，把每台设备的原始输出落盘，
解析成结构化指标，按阈值挑出关注项，最后给你一张横向对比表和一份 Markdown 报告。

- **只读**：不改任何配置，不进入 system-view。
- **SSH / Telnet 同一份清单**：设备记录里写 `protocol` 即可，Telnet 走 Netmiko 的 telnet 通道。
- **原始输出可复查**：`runs/<runId>/raw/<设备>.json` 保存每条命令的原文，解析出问题能对回去。
- **厂商可扩展**：命令集在 `profiles/<platform>.json`，解析器在 `lib/parsers/<platform>.js`；目前有 H3C Comware。

## 安装

仓库已声明 `dsh.bundle`，三种装法任选：

```sh
# 1) 从 npm（发布后）
dsh plugin add dsh-netops

# 2) 直接从 GitHub
dsh plugin add github:OWNER/dsh-netops

# 3) 本地目录（开发时）
dsh plugin add /path/to/dsh-netops
```

装好后在 **插件** 页能看到「网络运维（Ansible）」，工具 `netops_devices`、`netops_inspect`、`netops_run_report` 随即可用。

> 依赖：本机需要 Python 3.8+ 与 `netmiko`（`pip install netmiko`）。插件通过本地 Python 执行器登录设备；
> Ansible 执行层在后续版本接入，届时命令与解析逻辑不变。

## 配置

插件行的 config 只需要 **数据目录**：

```yaml
- id: dsh-netops
  name: dsh-netops
  config:
    rootDir: 'H:\网络问题\netops'
```

机器相关的东西（Python 路径、账号密码）放在数据目录下的 `netops.local.json`，**不进仓库、不进 profile 的 patch**：

```json
{
  "python": "C:\\...\\python.exe",
  "username": "admin",
  "password": "******"
}
```

优先级：环境变量 `NETOPS_PASSWORD` > `netops.local.json` > 插件 config > 内置默认值。

### 设备清单

`<rootDir>/devices.json`：

```json
{
  "devices": [
    { "id": "sw1", "host": "192.168.0.1", "protocol": "ssh", "platform": "h3c_comware", "group": "access" }
  ]
}
```

`protocol` 取 `ssh` 或 `telnet`；`platform` 对应 `profiles/` 里的文件名。

## 使用

```
你：巡检一下全部设备
你：只看核心交换机，用 telnet
你：把刚才那份报告发我
```

对应的工具调用与返回：

| 工具 | 作用 |
|---|---|
| `netops_devices` | 列出设备清单（id / 地址 / 协议 / 平台 / 分组） |
| `netops_inspect` | 巡检并生成报告；可指定 `devices`、`checks`、`protocol` |
| `netops_run_report` | 读回某次运行的完整报告 |

检查项：`identity`、`uptime`、`cpu`、`memory`、`fan`、`power`、`thermal`、`disk`。
阈值默认 CPU ≥ 80%、内存 ≥ 80%、磁盘 ≥ 85%、运行时长 < 24h 提示，可在 `netops.local.json` 的 `thresholds` 里改。

## 产物

```
<rootDir>/
├─ devices.json
├─ netops.local.json        # 本机配置与凭据
├─ runs/<runId>/
│  ├─ report.md             # 人类可读报告
│  ├─ summary.csv           # 多台横向对比
│  ├─ raw/<设备>.json        # 每条命令的原始输出
│  └─ meta.json
└─ reports/<runId>.md       # 长期留档
```

## 目录结构

```
index.js                 Host 入口（apply / 工具注册）
lib/options.js           配置解析与优先级
lib/store.js             设备清单读取
lib/inspect.js           巡检编排：生成任务 → 执行 → 解析 → 报告
lib/runner.js            起 Python 执行器（ctx.subprocess，失败退回 child_process）
lib/report.js            Markdown / CSV / 摘要表格
lib/parsers/h3c_comware.js  设备输出 → 结构化指标 + 告警判定
profiles/h3c_comware.json   命令集、登录参数、检查项映射
scripts/netops_runner.py    本地执行器（Netmiko，SSH 与 Telnet）
assets / locale / docs      图标、界面文案、插件详情
```

## 安全

- 巡检只跑只读命令，不需要 enable，也不进配置视图。
- 密码只存在于 `netops.local.json` 与本机进程内存；执行器的临时 job 文件在每次运行后删除，不写进报告。
- 报告只记录指标与非敏感字段；原始输出里如果出现密码（比如配置回显），提交 issue 前请先自查。

## 路线图

- [x] M1 只读巡检（H3C Comware）+ 报告
- [ ] M2 配置下发：模板 + 变量 → 渲染预览 → 备份 → 串行下发 → 回读
- [ ] M3 配置编写页面（设备清单、模板、预览、运行记录）
- [ ] M4 安全设备网页截图巡检
- [ ] 更多厂商 profile（Huawei VRP、Cisco IOS/NX-OS）

## License

MIT
