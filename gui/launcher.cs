using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

/// <summary>
/// dsh-netops 巡检面板的启动器：找到 node，跑 gui/launch.mjs，然后自己退出。
/// 面板会在 Edge/默认浏览器里以独立窗口（--app）打开，关掉窗口不影响已保存的报告。
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var script = Path.Combine(baseDir, "gui", "launch.mjs");

        if (!File.Exists(script))
        {
            MessageBox.Show(
                "找不到 gui\\launch.mjs。\n\n请把整个 dist 文件夹一起复制，不要只拿走 exe。",
                "dsh-netops",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        var node = FindNode(baseDir);
        if (node == null)
        {
            MessageBox.Show(
                "没有找到 Node.js。\n\n装一个 Node.js 20+（https://nodejs.org），\n或者把 node.exe 放到本程序同一个文件夹里。",
                "dsh-netops",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        var start = new ProcessStartInfo
        {
            FileName = node,
            Arguments = "\"" + script + "\"",
            WorkingDirectory = baseDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        try
        {
            Process.Start(start);
        }
        catch (Exception error)
        {
            MessageBox.Show("启动失败：" + error.Message, "dsh-netops", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string FindNode(string baseDir)
    {
        var local = Path.Combine(baseDir, "node.exe");
        if (File.Exists(local)) return local;

        var configured = Environment.GetEnvironmentVariable("NETOPS_NODE");
        if (!string.IsNullOrEmpty(configured) && File.Exists(configured)) return configured;

        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var entry in path.Split(';'))
        {
            if (string.IsNullOrWhiteSpace(entry)) continue;
            var candidate = Path.Combine(entry.Trim().Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }

        string[] fallbacks =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            @"C:\Program Files\nodejs\node.exe",
            @"D:\Node\node.exe",
        };

        foreach (var candidate in fallbacks)
        {
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }
}
