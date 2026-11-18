# 提交到 awesome-dsh-plugin 的 PR 材料

仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
方式：Fork → 新增**一个文件** `data/plugins/SeverusHuan__dsh-netops.yml` → 提 PR。
（不要手改 README，README 由脚本从 `data/plugins/*.yml` 生成。）

> 时间门槛：仓库创建满 1 天才会通过 CI。2026-11-18 建仓，**11-19 之后**再提。

## 新增文件内容

直接复制 `docs/market-entry.yml`（已填好地址与中英描述）：

```yaml
url: https://github.com/SeverusHuan/dsh-netops
name: SeverusHuan/dsh-netops
category: tools
description:
  en: Read-only inspection of network devices over SSH or Telnet for CPU, memory, fans, power, temperature, disk usage and uptime, with a per-run Markdown report and raw command output kept on disk.
  zh: 通过 SSH 或 Telnet 只读巡检网络设备的 CPU、内存、风扇、电源、温度、磁盘占用与运行时长，并按次生成 Markdown 报告、保留原始命令输出。
```

## PR 标题

```
Add SeverusHuan/dsh-netops — network device inspection for DSH
```

## PR 正文

```markdown
Adds `SeverusHuan/dsh-netops`, a read-only inspection plugin for network devices.

**What it does**

- Registers three tools: `netops_devices`, `netops_inspect`, `netops_run_report`.
- Logs in over SSH or Telnet (one device inventory, `protocol` per device), runs read-only
  `display` commands, and parses them into CPU, memory, fan, power, temperature, disk usage and uptime.
- Writes a per-run directory: `report.md`, `summary.csv`, and the raw command output of every device.
- Ships one vendor profile today: H3C Comware (tested on S5820V2 / S6850 in HCL).
  Profiles are data (`profiles/*.json`) plus a parser module, so adding a vendor doesn't touch the pipeline.

**Installability**

- `package.json` declares `dsh.bundle.patch` (`cordis.patch.yml` inserts one row named `dsh-netops`).
- No build step, no dependencies; the runtime requirement is local Python with `netmiko`.

**Notes**

- Inspection is read-only by design; configuration push is planned but **not** implemented,
  so it isn't claimed anywhere in the description or README.
- The description above lists exactly the checks the code performs today.

Tested against three H3C switches (SSH and Telnet), including an unreachable device to confirm
that one failure doesn't abort the run.
```

## 提完之后

- 维护者可能要求改描述；改动留在同一分支，回一条评论说明即可。
- 合并后站点与 dshmarket 通常一天内自动收录，不需要再提 PR。
- 之后发新版本只需要发 npm / GitHub Release，市场条目不用动。
