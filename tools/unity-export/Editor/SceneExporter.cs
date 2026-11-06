using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityGLTF;
using static Journey.UnityExport.Targets;

namespace Journey.UnityExport
{
    /// <summary>
    /// Exports every image target (IT_*) of the main scene to its own GLB.
    ///
    /// The children of the target are the glTF roots, so the content ends up in the target's
    /// local frame (page width = 1 unit, page in the XZ plane; glTF flips Z) and the page preview
    /// plane of the target itself is left out. Data the AR app needs but glTF cannot express is
    /// kept in extras: the original shader and all its properties on materials, audio sources and
    /// custom script fields (e.g. UV scroll rates) on nodes.
    ///
    /// Next to the GLB files an export-report.json lists what Unity had in each subtree, so the
    /// exported files can be checked against it. The scene is never saved.
    /// </summary>
    public static class SceneExporter
    {
        // Plugins kept enabled; everything else UnityGLTF offers stays off for a predictable output.
        private static readonly string[] EnabledPlugins = { "LightsPunctualExport", "MaterialExtensionsExport" };

        [Serializable]
        private class ClipInfo
        {
            public string node;
            public string name;
            public float length;
            public bool legacy;
            public string wrapMode;
            public bool isDefault;
            public int curves;
            // Curves whose path resolves under the animated object; others do nothing in Unity either.
            public int boundTransformCurves;
            // Bound curves that animate something other than transforms (e.g. material UV offsets),
            // which plain glTF animation cannot express.
            public string[] otherBoundCurves;
        }

        [Serializable]
        private class TargetReport
        {
            public string id;
            public string trackable;
            public string root;
            public float aspectRatio;
            public string file;
            public int meshRenderers;
            public int skinnedMeshRenderers;
            public int lights;
            public int audioSources;
            public int particleSystems;
            public int inactiveObjects;
            public int triangles;
            public int triangleStripMeshes;
            public int fixedNormalMeshes;
            public ClipInfo[] clips;
        }

        [Serializable]
        private class ExportReport
        {
            public TargetReport[] targets;
        }

        [MenuItem("Journey/Export AR Scenes")]
        public static void ExportAll()
        {
            var outDir = CommandLine.GetOutputDirectory("export");
            var only = CommandLine.GetOption("-journeyTargets")?.Split(',');

            var scene = EditorSceneManager.OpenScene(Targets.ScenePath, OpenSceneMode.Single);

            var reports = new List<TargetReport>();
            var failed = false;
            foreach (var target in Targets.Find(scene))
            {
                var (trackable, id, aspect) = Targets.Describe(target);
                if (only != null && !only.Contains(id)) continue;
                try
                {
                    reports.Add(Export(target, trackable, id, aspect, outDir));
                }
                catch (Exception e)
                {
                    failed = true;
                    Debug.LogError($"[Journey] export of {target.name} failed: {e}");
                }
            }

            var reportFile = Path.Combine(outDir, "export-report.json");
            File.WriteAllText(reportFile, JsonUtility.ToJson(new ExportReport { targets = reports.ToArray() }, true));
            Debug.Log($"[Journey] export {(failed ? "FAILED" : "done")}: {reports.Count} targets; report: {reportFile}");

            if (Application.isBatchMode) EditorApplication.Exit(failed ? 1 : 0);
            else EditorSceneManager.OpenScene(Targets.ScenePath, OpenSceneMode.Single);
        }

        private static TargetReport Export(GameObject target, string trackable, string id, float aspect, string outDir)
        {
            var roots = Enumerable.Range(0, target.transform.childCount)
                .Select(i => target.transform.GetChild(i))
                .Where(t => t.gameObject.activeSelf)
                .ToArray();

            var (stripMeshes, normalMeshes) = PrepareMeshes(roots);
            var triangles = CountTriangles(roots);

            var settings = ScriptableObject.CreateInstance<GLTFSettings>();
            settings.ExportNames = true;
            settings.ExportFullPath = false;
            settings.UseMainCameraVisibility = false;
            settings.ExportDisabledGameObjects = false;
            settings.ExportAnimations = true;
            settings.BakeAnimationSpeed = true;
            settings.UniqueAnimationNames = true;
            settings.BakeSkinnedMeshes = false;
            settings.ExportVertexColors = true;
            settings.UseCaching = false;
            foreach (var plugin in settings.ExportPlugins.Where(p => p != null))
            {
                plugin.Enabled = EnabledPlugins.Contains(plugin.GetType().Name);
            }

            var context = new ExportContext(settings)
            {
                AfterMaterialExport = (exporter, _, material, node) => node.Extras = DescribeMaterial(exporter, material),
                AfterNodeExport = (_, _, transform, node) =>
                {
                    var extras = DescribeComponents(transform);
                    if (extras != null) node.Extras = extras;
                },
                // Scene-wide lighting the materials were designed for (raw gamma-space values).
                AfterSceneExport = (_, gltf) =>
                {
                    foreach (var gltfScene in gltf.Scenes)
                    {
                        gltfScene.Extras = new JObject
                        {
                            ["unityColorSpace"] = QualitySettings.activeColorSpace.ToString(),
                            ["ambientMode"] = RenderSettings.ambientMode.ToString(),
                            ["ambient"] = ToArray(RenderSettings.ambientLight),
                            ["fog"] = RenderSettings.fog,
                        };
                    }
                },
            };

            var exporter = new GLTFSceneExporter(roots, context);
            exporter.SaveGLB(outDir, id);
            var file = Path.Combine(outDir, id + ".glb");
            Debug.Log($"[Journey] exported {target.name} ({trackable}) -> {file}; "
                + $"{stripMeshes} triangle-strip meshes converted, {normalMeshes} with normals fixed, {triangles} triangles");

            return new TargetReport
            {
                id = id,
                trackable = trackable,
                root = target.name,
                aspectRatio = aspect,
                file = Path.GetFileName(file),
                meshRenderers = Active<MeshRenderer>(roots).Count(r => r.enabled && r.GetComponent<MeshFilter>()?.sharedMesh),
                skinnedMeshRenderers = Active<SkinnedMeshRenderer>(roots).Count(r => r.enabled && r.sharedMesh),
                lights = Active<Light>(roots).Count(l => l.enabled),
                audioSources = Active<AudioSource>(roots).Count(),
                particleSystems = Active<ParticleSystem>(roots).Count(),
                inactiveObjects = roots.SelectMany(r => r.GetComponentsInChildren<Transform>(true)).Count(t => !t.gameObject.activeInHierarchy)
                    + target.transform.childCount - roots.Length,
                triangles = triangles,
                triangleStripMeshes = stripMeshes,
                fixedNormalMeshes = normalMeshes,
                clips = Active<Animation>(roots).SelectMany(DescribeClips).ToArray(),
            };
        }

        /// <summary>
        /// Replaces meshes of the subtree that glTF cannot take as they are with in-memory copies:
        /// triangle strips become triangle lists, non-unit normals are normalized.
        /// Mesh assets are not modified; the scene is never saved.
        /// </summary>
        private static (int strips, int normals) PrepareMeshes(IEnumerable<Transform> roots)
        {
            var converted = new Dictionary<Mesh, Mesh>();
            int strips = 0, normals = 0;
            Mesh Convert(Mesh mesh)
            {
                if (mesh == null) return null;
                if (converted.TryGetValue(mesh, out var copy)) return copy;
                var hasStrips = Enumerable.Range(0, mesh.subMeshCount).Any(i => (int)mesh.GetTopology(i) == TriangleStripTopology);
                var meshNormals = mesh.normals;
                var badNormals = meshNormals.Any(n => Mathf.Abs(n.sqrMagnitude - 1f) > 1e-3f);
                if (!hasStrips && !badNormals) return converted[mesh] = mesh;

                copy = UnityEngine.Object.Instantiate(mesh);
                copy.name = mesh.name;
                if (hasStrips)
                {
                    strips++;
                    for (var i = 0; i < mesh.subMeshCount; i++)
                    {
                        if ((int)mesh.GetTopology(i) != TriangleStripTopology) continue;
                        copy.SetIndices(StripToTriangles(mesh.GetIndices(i)), MeshTopology.Triangles, i, false);
                    }
                }
                if (badNormals)
                {
                    normals++;
                    for (var i = 0; i < meshNormals.Length; i++)
                    {
                        var length = meshNormals[i].magnitude;
                        meshNormals[i] = length > 1e-6f ? meshNormals[i] / length : Vector3.up;
                    }
                    copy.normals = meshNormals;
                }
                return converted[mesh] = copy;
            }

            foreach (var filter in Active<MeshFilter>(roots)) filter.sharedMesh = Convert(filter.sharedMesh);
            foreach (var skinned in Active<SkinnedMeshRenderer>(roots)) skinned.sharedMesh = Convert(skinned.sharedMesh);
            return (strips, normals);
        }

        /// <summary>Triangles drawn by the active renderers of the subtree (after strip conversion).</summary>
        private static int CountTriangles(IEnumerable<Transform> roots)
        {
            int Count(Mesh mesh) => mesh == null ? 0 : Enumerable.Range(0, mesh.subMeshCount)
                .Where(i => mesh.GetTopology(i) == MeshTopology.Triangles)
                .Sum(i => (int)mesh.GetIndexCount(i) / 3);
            return Active<MeshRenderer>(roots).Where(r => r.enabled).Sum(r => Count(r.GetComponent<MeshFilter>()?.sharedMesh))
                + Active<SkinnedMeshRenderer>(roots).Where(r => r.enabled).Sum(r => Count(r.sharedMesh));
        }

        private static IEnumerable<T> Active<T>(IEnumerable<Transform> roots) where T : Component =>
            roots.SelectMany(r => r.GetComponentsInChildren<T>(false));

        private static IEnumerable<ClipInfo> DescribeClips(Animation animation)
        {
            return AnimationUtility.GetAnimationClips(animation.gameObject).Where(c => c != null).Select(clip =>
            {
                var bindings = AnimationUtility.GetCurveBindings(clip);
                var bound = bindings.Where(b => AnimationUtility.GetAnimatedObject(animation.gameObject, b) != null).ToArray();
                return new ClipInfo
                {
                    node = animation.name,
                    name = clip.name,
                    length = clip.length,
                    legacy = clip.legacy,
                    wrapMode = clip.wrapMode.ToString(),
                    isDefault = clip == animation.clip,
                    curves = bindings.Length,
                    boundTransformCurves = bound.Count(b => b.type == typeof(Transform)),
                    otherBoundCurves = bound.Where(b => b.type != typeof(Transform))
                        .Select(b => $"{b.path}:{b.type.Name}.{b.propertyName}")
                        .ToArray(),
                };
            });
        }

        /// <summary>
        /// Original shader and all its properties. Every texture property is also exported into the
        /// GLB (lightmaps, detail and normal maps included), with its glTF texture index, Unity
        /// tiling/offset and wrap modes — UnityGLTF itself writes no wrap modes.
        /// </summary>
        private static JObject DescribeMaterial(GLTFSceneExporter exporter, Material material)
        {
            var shader = material.shader;
            var properties = new JObject();
            for (var i = 0; i < shader.GetPropertyCount(); i++)
            {
                var name = shader.GetPropertyName(i);
                switch (shader.GetPropertyType(i))
                {
                    case UnityEngine.Rendering.ShaderPropertyType.Color:
                        properties[name] = ToArray(material.GetColor(name));
                        break;
                    case UnityEngine.Rendering.ShaderPropertyType.Vector:
                        properties[name] = ToArray(material.GetVector(name));
                        break;
                    case UnityEngine.Rendering.ShaderPropertyType.Float:
                    case UnityEngine.Rendering.ShaderPropertyType.Range:
                        properties[name] = material.GetFloat(name);
                        break;
                    case UnityEngine.Rendering.ShaderPropertyType.Int:
                        properties[name] = material.GetInteger(name);
                        break;
                    case UnityEngine.Rendering.ShaderPropertyType.Texture:
                        var texture = material.GetTexture(name);
                        if (texture == null)
                        {
                            properties[name] = null;
                            break;
                        }
                        var slot = name == "_BumpMap"
                            ? GLTFSceneExporter.TextureMapType.Normal
                            : GLTFSceneExporter.TextureMapType.BaseColor;
                        properties[name] = new JObject
                        {
                            ["texture"] = texture.name,
                            ["index"] = exporter.ExportTextureInfo(texture, slot)?.Index?.Id,
                            ["scale"] = ToArray(material.GetTextureScale(name)),
                            ["offset"] = ToArray(material.GetTextureOffset(name)),
                            ["wrapU"] = texture.wrapModeU.ToString(),
                            ["wrapV"] = texture.wrapModeV.ToString(),
                            ["filter"] = texture.filterMode.ToString(),
                        };
                        break;
                }
            }
            return new JObject
            {
                ["unityMaterial"] = material.name,
                ["unityShader"] = shader.name,
                ["renderQueue"] = material.renderQueue,
                ["properties"] = properties,
            };
        }

        /// <summary>Audio sources and custom script fields of a node, or null if it has none.</summary>
        private static JObject DescribeComponents(Transform transform)
        {
            var components = new JArray();
            foreach (var light in transform.GetComponents<Light>())
            {
                // Range in the target's local frame (the target root is scaled to its width).
                var targetScale = transform.root.lossyScale.x;
                components.Add(new JObject
                {
                    ["type"] = "Light",
                    ["enabled"] = light.enabled,
                    ["lightType"] = light.type.ToString(),
                    ["color"] = ToArray(light.color),
                    ["intensity"] = light.intensity,
                    ["range"] = light.range / targetScale,
                    ["spotAngle"] = light.spotAngle,
                    ["renderMode"] = light.renderMode.ToString(),
                });
            }
            foreach (var audio in transform.GetComponents<AudioSource>())
            {
                components.Add(new JObject
                {
                    ["type"] = "AudioSource",
                    ["clip"] = audio.clip ? audio.clip.name : null,
                    ["clipPath"] = audio.clip ? AssetDatabase.GetAssetPath(audio.clip) : null,
                    ["volume"] = audio.volume,
                    ["loop"] = audio.loop,
                    ["playOnAwake"] = audio.playOnAwake,
                    ["spatialBlend"] = audio.spatialBlend,
                });
            }
            foreach (var behaviour in transform.GetComponents<MonoBehaviour>().Where(b => b != null))
            {
                var fields = new JObject { ["type"] = behaviour.GetType().Name, ["enabled"] = behaviour.enabled };
                var property = new SerializedObject(behaviour).GetIterator();
                var enterChildren = true;
                while (property.NextVisible(enterChildren))
                {
                    enterChildren = false;
                    if (property.name == "m_Script") continue;
                    var value = ToJson(property);
                    if (value != null) fields[property.name] = value;
                }
                components.Add(fields);
            }
            return components.Count == 0 ? null : new JObject { ["unityComponents"] = components };
        }

        private static JToken ToJson(SerializedProperty property)
        {
            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer: return property.intValue;
                case SerializedPropertyType.Boolean: return property.boolValue;
                case SerializedPropertyType.Float: return property.floatValue;
                case SerializedPropertyType.String: return property.stringValue;
                case SerializedPropertyType.Enum: return property.enumDisplayNames.ElementAtOrDefault(property.enumValueIndex);
                case SerializedPropertyType.Color: return ToArray(property.colorValue);
                case SerializedPropertyType.Vector2: return ToArray(property.vector2Value);
                case SerializedPropertyType.Vector3: return ToArray(property.vector3Value);
                case SerializedPropertyType.Vector4: return ToArray(property.vector4Value);
                case SerializedPropertyType.ObjectReference:
                    return property.objectReferenceValue ? property.objectReferenceValue.name : null;
                default: return null;
            }
        }
    }
}
