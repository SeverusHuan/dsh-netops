#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""netops 执行器：读 job.json，逐台登录设备跑只读命令，写 result.json。

用法：python netops_runner.py <job.json> <result.json>

job.json:
{
  "devices": [{"id","host","port","protocol","netmiko","username","password"}],
  "commands": [{"key","command"}],
  "options": {"connTimeoutSec","readTimeoutSec","deviceTimeoutSec"}
}

设计约束：
- 单台失败不影响其他设备；单条命令失败只记录该条。
- 密码只存在于这个临时文件里，插件侧跑完即删。
"""

import json
import sys
import time
import warnings

warnings.filterwarnings("ignore")


def clean_prompt(prompt):
    text = (prompt or "").strip()
    for opener, closer in (("<", ">"), ("[", "]"), ("(", ")")):
        if text.startswith(opener) and text.endswith(closer):
            text = text[1:-1]
    if "(" in text:
        text = text.split("(", 1)[0]
    return text.strip() or None


def short_error(error, limit=200):
    """异常信息压成一行：报告里要能读懂，不要把整段 netmiko 提示塞进去。"""
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    head = lines[0] if lines else ""
    return ("%s: %s" % (type(error).__name__, head))[:limit]


def run_device(device, commands, options):
    started = time.time()
    record = {
        "id": device.get("id"),
        "host": device.get("host"),
        "protocol": device.get("protocol"),
        "ok": False,
        "outputs": {},
        "errors": {},
    }
    connection = None
    try:
        from netmiko import ConnectHandler

        connection = ConnectHandler(
            device_type=device["netmiko"],
            host=device["host"],
            port=int(device.get("port") or 22),
            username=device.get("username"),
            password=device.get("password"),
            fast_cli=False,
            conn_timeout=int(options.get("connTimeoutSec", 15)),
            auth_timeout=int(options.get("connTimeoutSec", 15)),
            banner_timeout=int(options.get("connTimeoutSec", 15)),
        )
        record["hostname"] = clean_prompt(connection.find_prompt())

        read_timeout = int(options.get("readTimeoutSec", 30))
        for item in commands:
            key = item.get("key")
            command = item.get("command")
            try:
                record["outputs"][key] = connection.send_command(
                    command,
                    read_timeout=read_timeout,
                    strip_prompt=True,
                    strip_command=True,
                )
            except Exception as error:  # noqa: BLE001 - 单条命令失败要记录下来继续
                record["errors"][key] = short_error(error)
        record["ok"] = True
    except Exception as error:  # noqa: BLE001 - 单台设备失败不影响整批
        record["error"] = short_error(error, 300)
    finally:
        if connection is not None:
            try:
                connection.disconnect()
            except Exception:  # noqa: BLE001
                pass
    record["elapsedSec"] = round(time.time() - started, 1)
    return record


def main():
    if len(sys.argv) < 3:
        print("usage: netops_runner.py <job.json> <result.json>", file=sys.stderr)
        return 2

    job_path, result_path = sys.argv[1], sys.argv[2]
    with open(job_path, "r", encoding="utf-8") as handle:
        job = json.load(handle)

    commands = job.get("commands") or []
    options = job.get("options") or {}
    devices = job.get("devices") or []

    results = []
    for device in devices:
        results.append(run_device(device, commands, options))

    payload = {
        "ok": True,
        "hostname": None,
        "devices": results,
        "meta": {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "count": len(results)},
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    print("netops runner: %d device(s) done" % len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
