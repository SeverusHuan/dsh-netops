# 网络运维（Ansible）

给 agent 用的网络设备巡检能力：只读命令 → 结构化指标 → 可追溯报告。

## 现在能做什么

- `netops_devices`：列出在 `devices.json` 里登记的设备（id、管理地址、协议、平台、分组）。
- `netops_inspect`：对指定设备（或全部）跑一组只读命令，解析设备身份、运行时长、CPU、内存、风扇、电源、温度、磁盘，按阈值给出关注项，并在 `runs/<runId>/` 下留原始输出与 `report.md`。
- `netops_run_report`：把某次运行的报告读回来。

巡检只读、不碰配置。下发能力（模板渲染 + 备份 + 串行下发）是下一阶段。

## 执行方式

当前版本用一个本地 Python 执行器（`scripts/netops_runner.py`，Netmiko）登录设备收发命令：

- SSH 与 Telnet 都支持（同一份设备清单，用 `protocol` 区分）；
- 每台设备独立会话，单条命令有读超时，失败只影响该条命令或该台设备；
- 输出原样落盘到 `runs/<runId>/raw/<id>.json`，解析在插件里做，换厂商只改 `profiles/*.json` 与解析器。

> Ansible 执行层（inventory + playbook + `cli_command`）在 WSL/Linux 就绪后接入，命令与解析逻辑不变。

## 设备清单

`<rootDir>/devices.json`：

```json
{
  "devices": [
    {
      "id": "sw1",
      "host": "192.168.0.1",
      "protocol": "ssh",
      "platform": "h3c_comware",
      "group": "access",
      "username": "admin"
    }
  ]
}
```

密码默认取配置 `password`，环境变量 `NETOPS_PASSWORD` 优先；设备上的 `password` 字段可覆盖。

## 已知限制

- 解析器目前只有 H3C Comware（HCL 实测），Huawei VRP / Cisco 待真机样本；
- `display alarm` 在 Comware 7 交换机上不存在，会被标成「命令不支持」而不是错误；
- 本地执行器是串行的，设备多时耗时线性增长，Ansible 层接入后再做并发。
