using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Linq;
using System.Text;
using System.Reflection;

[assembly: AssemblyTitle("Codex Composer HUD")]
[assembly: AssemblyProduct("Codex Composer HUD")]
[assembly: AssemblyCompany("Codex Composer HUD contributors")]
[assembly: AssemblyVersion("1.6.1.0")]
[assembly: AssemblyFileVersion("1.6.1.0")]

internal static class Launcher {
    [STAThread]
    private static void Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        if (args.Contains("--configure-auto")) { AutoLaunch.Enable(root); return; }
        if (args.Contains("--remove-auto")) { AutoLaunch.Disable(root); return; }
        string node = Path.Combine(root, "runtime", "node.exe");
        if (!File.Exists(node)) {
            MessageBox.Show("runtime 폴더와 함께 압축을 풀어 실행하세요.", "Codex Composer HUD", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string command = "\"" + Path.Combine(root, "launcher.mjs") + "\"";
        if (Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("Stop")) command += " --stop";
        else if (args.Length == 1 && args[0] == "--stop") command += " --stop";
        else foreach (string argument in args) command += " " + Quote(argument);
        try {
            Process.Start(new ProcessStartInfo(node, command) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true });
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Codex Composer HUD", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
    private static string Quote(string value) {
        StringBuilder result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) { if (c == '\\') { slashes++; continue; } if (c == '"') result.Append('\\', slashes * 2 + 1); else result.Append('\\', slashes); result.Append(c); slashes = 0; }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
}
