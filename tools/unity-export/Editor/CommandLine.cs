using System;
using System.IO;
using UnityEngine;

namespace Journey.UnityExport
{
    internal static class CommandLine
    {
        /// <summary>Value that follows <paramref name="name"/> on the command line, or null.</summary>
        public static string GetOption(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == name) return args[i + 1];
            }
            return null;
        }

        /// <summary>Output directory from -journeyOut, or tools/.out/&lt;fallback&gt; in the repository.</summary>
        public static string GetOutputDirectory(string fallbackName)
        {
            var dir = GetOption("-journeyOut")
                ?? Path.Combine(Application.dataPath, "..", "..", "tools", ".out", fallbackName);
            dir = Path.GetFullPath(dir);
            Directory.CreateDirectory(dir);
            return dir;
        }
    }
}
