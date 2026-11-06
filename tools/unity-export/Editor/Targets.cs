using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Journey.UnityExport
{
    /// <summary>Helpers shared by the exporter and the reference renderer.</summary>
    internal static class Targets
    {
        public const string ScenePath = "Assets/Scene/_Main.unity";

        // Unity 4 meshes store submeshes as triangle strips (topology 1, no longer in the public
        // MeshTopology enum). Unity still renders them, but glTF export needs triangle lists.
        public const int TriangleStripTopology = 1;

        /// <summary>Image target roots (IT_*) of the scene, sorted by name.</summary>
        public static GameObject[] Find(Scene scene) =>
            scene.GetRootGameObjects().Where(r => r.name.StartsWith("IT_")).OrderBy(r => r.name).ToArray();

        /// <summary>Trackable name, file id and aspect ratio from the (stubbed) Vuforia ImageTargetBehaviour.</summary>
        public static (string trackable, string id, float aspect) Describe(GameObject target)
        {
            foreach (var behaviour in target.GetComponents<MonoBehaviour>().Where(b => b != null))
            {
                var serialized = new SerializedObject(behaviour);
                var name = serialized.FindProperty("mTrackableName");
                if (name != null && !string.IsNullOrEmpty(name.stringValue))
                {
                    var aspect = serialized.FindProperty("mAspectRatio");
                    return (name.stringValue, name.stringValue.ToLowerInvariant(), aspect?.floatValue ?? 0f);
                }
            }
            throw new InvalidOperationException($"{target.name} has no trackable name");
        }

        /// <summary>Triangle list from strip indices: odd triangles swap winding, degenerate ones are dropped.</summary>
        public static int[] StripToTriangles(int[] strip)
        {
            var triangles = new List<int>(Math.Max(0, strip.Length - 2) * 3);
            for (var i = 0; i + 2 < strip.Length; i++)
            {
                int a = strip[i], b = strip[i + 1], c = strip[i + 2];
                if (a == b || b == c || a == c) continue;
                if ((i & 1) == 0) triangles.AddRange(new[] { a, b, c });
                else triangles.AddRange(new[] { b, a, c });
            }
            return triangles.ToArray();
        }

        /// <summary>Triangle indices of a submesh, whatever its topology (strips are converted).</summary>
        public static int[] Triangles(Mesh mesh, int submesh) =>
            (int)mesh.GetTopology(submesh) == TriangleStripTopology
                ? StripToTriangles(mesh.GetIndices(submesh))
                : mesh.GetIndices(submesh);

        public static JArray ToArray(Color c) => new JArray(c.r, c.g, c.b, c.a);
        public static JArray ToArray(Vector2 v) => new JArray(v.x, v.y);
        public static JArray ToArray(Vector3 v) => new JArray(v.x, v.y, v.z);
        public static JArray ToArray(Vector4 v) => new JArray(v.x, v.y, v.z, v.w);
    }
}
