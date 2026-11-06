using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEngine;

namespace Journey.UnityExport
{
    /// <summary>
    /// Reports whether the converted project is usable: scripts compile (otherwise this method
    /// could not run at all), every shader in Assets compiles, every material has a working shader.
    /// </summary>
    public static class ProjectCheck
    {
        [Serializable]
        private class ShaderReport
        {
            public string path;
            public string name;
            public bool hasError;
            public bool supported;
            public string[] errors;
        }

        [Serializable]
        private class MaterialReport
        {
            public string path;
            public string shader;
            public bool ok;
        }

        [Serializable]
        private class Report
        {
            public bool ok;
            public bool scriptCompilationFailed;
            public int brokenShaders;
            public int brokenMaterials;
            public ShaderReport[] shaders;
            public MaterialReport[] materials;
        }

        [MenuItem("Journey/Check Project")]
        public static void Run()
        {
            var shaders = AssetDatabase.FindAssets("t:Shader", new[] { "Assets" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(path =>
                {
                    var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                    return new ShaderReport
                    {
                        path = path,
                        name = shader.name,
                        hasError = ShaderUtil.ShaderHasError(shader),
                        supported = shader.isSupported,
                        errors = ShaderUtil.GetShaderMessages(shader)
                            .Where(m => m.severity == ShaderCompilerMessageSeverity.Error)
                            .Select(m => $"{m.message} (line {m.line})")
                            .Distinct()
                            .ToArray(),
                    };
                })
                .OrderBy(s => s.path)
                .ToArray();

            var materials = AssetDatabase.FindAssets("t:Material", new[] { "Assets" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(path =>
                {
                    var shader = AssetDatabase.LoadAssetAtPath<Material>(path).shader;
                    var ok = shader != null
                        && shader.isSupported
                        && !ShaderUtil.ShaderHasError(shader)
                        && shader.name != "Hidden/InternalErrorShader";
                    return new MaterialReport { path = path, shader = shader ? shader.name : "(none)", ok = ok };
                })
                .OrderBy(m => m.path)
                .ToArray();

            var report = new Report
            {
                scriptCompilationFailed = EditorUtility.scriptCompilationFailed,
                brokenShaders = shaders.Count(s => s.hasError || !s.supported),
                brokenMaterials = materials.Count(m => !m.ok),
                shaders = shaders,
                materials = materials,
            };
            report.ok = !report.scriptCompilationFailed && report.brokenShaders == 0 && report.brokenMaterials == 0;

            var outFile = Path.Combine(CommandLine.GetOutputDirectory("unity"), "project-check.json");
            File.WriteAllText(outFile, JsonUtility.ToJson(report, true));

            foreach (var s in shaders.Where(s => s.hasError || !s.supported))
            {
                Debug.Log($"[Journey] BROKEN shader {s.path} ({s.name}): {string.Join("; ", s.errors)}");
            }
            foreach (var m in materials.Where(m => !m.ok))
            {
                Debug.Log($"[Journey] BROKEN material {m.path} (shader {m.shader})");
            }
            Debug.Log($"[Journey] shaders: {shaders.Length} ({report.brokenShaders} broken), "
                + $"materials: {materials.Length} ({report.brokenMaterials} broken), "
                + $"script compilation failed: {report.scriptCompilationFailed}");
            Debug.Log($"[Journey] project check {(report.ok ? "PASSED" : "FAILED")}; report: {outFile}");

            if (Application.isBatchMode) EditorApplication.Exit(report.ok ? 0 : 1);
        }
    }
}
