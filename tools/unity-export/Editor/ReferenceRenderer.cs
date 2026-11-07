using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Journey.UnityExport.Targets;

namespace Journey.UnityExport
{
    /// <summary>
    /// Renders every image target (IT_*) of the main scene on its own to &lt;id&gt;.png, from a fixed
    /// three-quarter view above the page, with animations sampled at a fixed time.
    ///
    /// reference.json describes each render in the target's local frame (Unity coordinates, page
    /// width = 1): camera, lights, ambient colour and the page plane of the Vuforia target, whose
    /// texture is saved as &lt;id&gt;-target.png. With it the three.js port can be rendered from exactly
    /// the same view and compared. The scene is never saved.
    /// </summary>
    public static class ReferenceRenderer
    {
        private const int Width = 1600;
        private const int Height = 1200;
        private const float FieldOfView = 50f;
        private static readonly Color Background = new Color(0.35f, 0.35f, 0.38f);

        [MenuItem("Journey/Render Reference Images")]
        public static void RenderAll()
        {
            var outDir = CommandLine.GetOutputDirectory("reference");
            var time = float.Parse(CommandLine.GetOption("-journeyTime") ?? "0.5", CultureInfo.InvariantCulture);
            // Debugging aids: render only some targets, hide renderers by material name.
            var only = CommandLine.GetOption("-journeyTargets")?.Split(',');
            var hidden = CommandLine.GetOption("-journeyHide")?.Split(',') ?? new string[0];
            // Close-up: frame this object (by name) instead of the whole page.
            var focus = CommandLine.GetOption("-journeyFocus");

            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var roots = scene.GetRootGameObjects();
            var targets = Find(scene);

            // Keep only the targets and global lights; drop the AR camera and the old UI.
            foreach (var root in roots)
            {
                if (!root.name.StartsWith("IT_") && root.GetComponent<Light>() == null) root.SetActive(false);
            }

            var descriptions = new JArray();
            foreach (var renderer in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (renderer.sharedMaterials.Any(m => m != null && hidden.Contains(m.name))) renderer.enabled = false;
            }

            foreach (var target in targets)
            {
                var (trackable, id, _) = Describe(target);
                if (only != null && !only.Contains(id)) continue;
                foreach (var other in targets) other.SetActive(other == target);
                SampleAnimations(target, time);
                ApplyUvScrolling(target, time);

                var description = Render(target, Path.Combine(outDir, $"{id}.png"), focus);
                description["id"] = id;
                description["trackable"] = trackable;
                description["root"] = target.name;
                description["image"] = $"{id}.png";
                description["time"] = time;
                description["page"] = DescribePage(target, outDir, id);
                description["lights"] = new JArray(Object.FindObjectsByType<Light>(FindObjectsSortMode.InstanceID)
                    .Where(l => l.isActiveAndEnabled)
                    .Select(l => DescribeLight(l, target.transform)));
                description["ambient"] = ToArray(RenderSettings.ambientLight);
                descriptions.Add(description);
                Debug.Log($"[Journey] rendered {target.name} at t={time.ToString(CultureInfo.InvariantCulture)}s -> {id}.png");
            }

            var json = new JObject
            {
                ["frame"] = "Unity, target-local (page width = 1, page in the XZ plane)",
                ["width"] = Width,
                ["height"] = Height,
                ["background"] = ToArray(Background),
                ["targets"] = descriptions,
            };
            File.WriteAllText(Path.Combine(outDir, "reference.json"), json.ToString(Formatting.Indented));

            if (Application.isBatchMode)
            {
                EditorApplication.Exit(0);
            }
            else
            {
                // Discard the in-memory changes made for rendering.
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
        }

        private static void SampleAnimations(GameObject target, float time)
        {
            foreach (var animation in target.GetComponentsInChildren<Animation>(true))
            {
                // Explicit null checks: `??` would bypass UnityEngine.Object's null semantics.
                var clip = animation.clip;
                if (clip == null) clip = AnimationUtility.GetAnimationClips(animation.gameObject).FirstOrDefault();
                if (clip != null) clip.SampleAnimation(animation.gameObject, Mathf.Repeat(time, clip.length));
            }
        }

        /// <summary>
        /// What the (stubbed) AnimatedUVs_* scripts do at runtime after <paramref name="time"/> seconds:
        /// texture offset = rate * time on a per-renderer copy of the material. Scripts do not run
        /// in edit mode, so the reference applies it here; the assets are not touched.
        /// </summary>
        private static void ApplyUvScrolling(GameObject target, float time)
        {
            foreach (var behaviour in target.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (behaviour == null || !behaviour.enabled || !behaviour.GetType().Name.StartsWith("AnimatedUVs")) continue;
                var renderer = behaviour.GetComponent<Renderer>();
                if (renderer == null) continue;
                var fields = new SerializedObject(behaviour);
                var index = fields.FindProperty("materialIndex").intValue;
                var rate = fields.FindProperty("uvAnimationRate").vector2Value;
                var textureName = fields.FindProperty("textureName").stringValue;
                var materials = renderer.sharedMaterials;
                if (index < 0 || index >= materials.Length || materials[index] == null) continue;
                var copy = new Material(materials[index]);
                copy.SetTextureOffset(textureName, rate * time);
                materials[index] = copy;
                renderer.sharedMaterials = materials;
            }
        }

        /// <summary>Renders the target to a PNG and returns its camera in the target's local frame.</summary>
        private static JObject Render(GameObject target, string file, string focus = null)
        {
            // Frame the page plane (the target's own renderer) with room for the content above it,
            // or, for a close-up, the renderer of the object named `focus` and its surroundings.
            var page = target.GetComponent<Renderer>();
            var focused = string.IsNullOrEmpty(focus)
                ? null
                : target.GetComponentsInChildren<Renderer>(true).FirstOrDefault(r => r.name == focus);
            var bounds = focused != null
                ? focused.bounds
                : page != null
                    ? page.bounds
                    : target.GetComponentsInChildren<Renderer>().Select(r => r.bounds).Aggregate((a, b) => { a.Encapsulate(b); return a; });
            var t = target.transform;
            var radius = bounds.extents.magnitude * (focused != null ? 3f : 1.6f);
            var distance = radius / Mathf.Sin(FieldOfView * 0.5f * Mathf.Deg2Rad);
            var position = bounds.center + (t.up - t.forward).normalized * distance;

            var cameraObject = new GameObject("JourneyReferenceCamera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = FieldOfView;
                // Like the phones the content was made for: an 8-bit buffer, where colours above 1
                // (the "double" combiners) clip before blending. HDR would let them blow out.
                camera.allowHDR = false;
                cameraObject.transform.position = position;
                cameraObject.transform.LookAt(bounds.center, t.up);
                camera.nearClipPlane = distance * 0.01f;
                camera.farClipPlane = distance * 100f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Background;

                var rt = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                camera.targetTexture = rt;
                camera.Render();
                File.WriteAllBytes(file, ReadPixels(rt));
                camera.targetTexture = null;
                rt.Release();
                Object.DestroyImmediate(rt);

                var scale = t.lossyScale.x;
                return new JObject
                {
                    ["camera"] = new JObject
                    {
                        ["fov"] = FieldOfView,
                        ["near"] = camera.nearClipPlane / scale,
                        ["far"] = camera.farClipPlane / scale,
                        ["position"] = ToArray(t.InverseTransformPoint(position)),
                        ["target"] = ToArray(t.InverseTransformPoint(bounds.center)),
                        ["up"] = ToArray(t.InverseTransformDirection(t.up)),
                    },
                };
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
            }
        }

        /// <summary>The Vuforia page plane: mesh in target-local coordinates and its texture as PNG.</summary>
        private static JObject DescribePage(GameObject target, string outDir, string id)
        {
            var filter = target.GetComponent<MeshFilter>();
            var renderer = target.GetComponent<Renderer>();
            if (filter == null || filter.sharedMesh == null) return null;
            var mesh = filter.sharedMesh;

            string image = null;
            var texture = renderer != null && renderer.sharedMaterial != null ? renderer.sharedMaterial.mainTexture : null;
            if (texture != null)
            {
                // Blit instead of GetPixels: works for textures that are not CPU-readable.
                var rt = RenderTexture.GetTemporary(texture.width, texture.height, 0, RenderTextureFormat.ARGB32);
                Graphics.Blit(texture, rt);
                image = $"{id}-target.png";
                File.WriteAllBytes(Path.Combine(outDir, image), ReadPixels(rt));
                RenderTexture.ReleaseTemporary(rt);
            }

            var material = renderer != null ? renderer.sharedMaterial : null;
            return new JObject
            {
                ["shader"] = material != null ? material.shader.name : null,
                ["color"] = material != null && material.HasProperty("_Color") ? ToArray(material.color) : null,
                ["vertices"] = new JArray(mesh.vertices.Select(ToArray)),
                ["uv"] = new JArray(mesh.uv.Select(ToArray)),
                ["triangles"] = new JArray(Enumerable.Range(0, mesh.subMeshCount).SelectMany(i => Triangles(mesh, i))),
                ["image"] = image,
                ["imageSize"] = texture != null ? new JArray(texture.width, texture.height) : null,
            };
        }

        private static JObject DescribeLight(Light light, Transform target)
        {
            var scale = target.lossyScale.x;
            return new JObject
            {
                ["name"] = light.name,
                ["type"] = light.type.ToString(),
                ["color"] = ToArray(light.color),
                ["intensity"] = light.intensity,
                ["range"] = light.range / scale,
                ["spotAngle"] = light.spotAngle,
                ["position"] = ToArray(target.InverseTransformPoint(light.transform.position)),
                ["direction"] = ToArray(target.InverseTransformDirection(light.transform.forward)),
                ["inTarget"] = light.transform.IsChildOf(target),
            };
        }

        private static byte[] ReadPixels(RenderTexture rt)
        {
            var previous = RenderTexture.active;
            RenderTexture.active = rt;
            var image = new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            var png = image.EncodeToPNG();
            Object.DestroyImmediate(image);
            return png;
        }
    }
}
