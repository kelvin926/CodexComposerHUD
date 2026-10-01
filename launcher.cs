using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node.exe");
        if (!File.Exists(node)) {
            MessageBox.Show("runtime 폴더와 함께 압축을 풀어 실행하세요.", "Codex Composer HUD", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string command = "\"" + Path.Combine(root, "launcher.mjs") + "\"";
        if (Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("Stop")) command += " --stop";
        else if (args.Length == 1 && args[0] == "--stop") command += " --stop";
        try {
            Process.Start(new ProcessStartInfo(node, command) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true });
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Codex Composer HUD", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
