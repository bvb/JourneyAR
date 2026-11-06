using System.Globalization;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Journey.UnityExport
{
    /// <summary>
    /// Renders every image target (IT_*) of the main scene on its own to a PNG, from a fixed
    /// three-quarter view above the page, with animations sampled at a fixed time. The images
    /// are references for checking materials now and the three.js port later.
    /// The scene is never saved.
    /// </summary>
    public static class ReferenceRenderer
    {
        private const string ScenePath = "Assets/Scene/_Main.unity";
        private const int Width = 1600;
        private const int Height = 1200;

        [MenuItem("Journey/Render Reference Images")]
        public static void RenderAll()
        {
            var outDir = CommandLine.GetOutputDirectory("reference");
            var time = float.Parse(CommandLine.GetOption("-journeyTime") ?? "0.5", CultureInfo.InvariantCulture);

            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var roots = scene.GetRootGameObjects();
            var targets = roots.Where(r => r.name.StartsWith("IT_")).ToArray();

            // Keep only the targets and global lights; drop the AR camera and the old UI.
            foreach (var root in roots)
            {
                if (!root.name.StartsWith("IT_") && root.GetComponent<Light>() == null) root.SetActive(false);
            }

            foreach (var target in targets)
            {
                foreach (var other in targets) other.SetActive(other == target);
                SampleAnimations(target, time);
                var file = Path.Combine(outDir, $"{target.name}.png");
                Render(target, file);
                Debug.Log($"[Journey] rendered {target.name} at t={time.ToString(CultureInfo.InvariantCulture)}s -> {file}");
            }

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

        private static void Render(GameObject target, string file)
        {
            // Frame the page plane (the target's own renderer) with room for the content above it.
            var page = target.GetComponent<Renderer>();
            var bounds = page != null
                ? page.bounds
                : target.GetComponentsInChildren<Renderer>().Select(r => r.bounds).Aggregate((a, b) => { a.Encapsulate(b); return a; });
            var t = target.transform;
            var radius = bounds.extents.magnitude * 1.6f;

            var cameraObject = new GameObject("JourneyReferenceCamera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = 50f;
                var distance = radius / Mathf.Sin(camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
                var direction = (t.up - t.forward).normalized;
                cameraObject.transform.position = bounds.center + direction * distance;
                cameraObject.transform.LookAt(bounds.center, t.up);
                camera.nearClipPlane = distance * 0.01f;
                camera.farClipPlane = distance * 100f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.35f, 0.35f, 0.38f);

                var rt = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                camera.targetTexture = rt;
                camera.Render();

                var previous = RenderTexture.active;
                RenderTexture.active = rt;
                var image = new Texture2D(Width, Height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                image.Apply();
                RenderTexture.active = previous;

                File.WriteAllBytes(file, image.EncodeToPNG());
                camera.targetTexture = null;
                Object.DestroyImmediate(image);
                rt.Release();
                Object.DestroyImmediate(rt);
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
            }
        }
    }
}
