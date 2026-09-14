using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Worldsmith.Editor
{
    /// <summary>
    /// Live-scene generalisation of Puntsy's OverlapAudit.cs, adapted to be project-agnostic:
    /// grouping now comes from <see cref="WorldsmithInstance.groupId"/> (a component) instead of
    /// walking up to the nearest ancestor named "---Something---" (a naming CONVENTION specific
    /// to one project's scene-hierarchy style). Any Unity project can use this without adopting
    /// that convention — it only needs the marker component, which WorldsmithBuilder already
    /// attaches to everything it places.
    ///
    /// WHY THIS EXISTS ALONGSIDE THE PURE-JSON VALIDATOR RATHER THAN INSTEAD OF IT: the pre-build
    /// check (server/src/validators/overlap.ts) runs on the AABBs the layout DECLARES. This one
    /// runs on the colliders Unity ACTUALLY built, which can differ — a prefab's real collider
    /// doesn't match its declared placement size, a nested prefab has its own sub-colliders, or
    /// (a real bug hit building this project's own proving ground) a freshly-instantiated
    /// object's Collider.bounds is stale until PhysX syncs its scene, which is why this calls
    /// Physics.SyncTransforms() first.
    /// </summary>
    public static class WorldsmithOverlapAudit
    {
        public struct Finding
        {
            public string aPath, bPath;
            public Vector3 centre;
            public float volumeRatio;
        }

        public const float DefaultVolumeRatioThreshold = 0.08f;

        [MenuItem("Tools/Worldsmith/Audit Overlaps (open scene)")]
        public static void AuditOpenSceneMenuItem()
        {
            List<Finding> findings = Audit(null);

            if (findings.Count == 0)
            {
                Debug.Log("[Worldsmith] No interpenetrating colliders.");
                return;
            }

            Debug.LogWarning($"[Worldsmith] {findings.Count} interpenetrating pair(s):");
            foreach (Finding f in findings)
                Debug.LogWarning($"[Worldsmith]   {f.aPath}  x  {f.bPath}  @ {f.centre}  ({f.volumeRatio * 100f:F0}%)");
        }

        /// <param name="root">Restrict the scan to this subtree, or null for the whole open scene.</param>
        public static List<Finding> Audit(Transform root, float volumeRatioThreshold = DefaultVolumeRatioThreshold)
        {
            // Colliders on an object placed earlier in the SAME editor tick can report stale
            // (often literal world-origin) bounds until PhysX's scene state is flushed. Caught
            // the hard way: this exact omission produced dozens of nonsense "overlap @ (0,0,0)"
            // findings the first time an equivalent tool ran immediately after a build pass.
            Physics.SyncTransforms();

            var findings = new List<Finding>();

            IEnumerable<Collider> all = root == null
                ? Object.FindObjectsByType<Collider>(FindObjectsSortMode.None)
                : root.GetComponentsInChildren<Collider>();

            Collider[] colliders = all.Where(c => c != null && !c.isTrigger && c.gameObject.activeInHierarchy).ToArray();

            for (int i = 0; i < colliders.Length; i++)
            {
                Bounds a = colliders[i].bounds;
                float volA = Volume(a.size);
                if (volA < 1e-4f) continue;

                for (int j = i + 1; j < colliders.Length; j++)
                {
                    if (SameGroup(colliders[i].transform, colliders[j].transform)) continue;

                    Bounds b = colliders[j].bounds;
                    if (!a.Intersects(b)) continue;

                    float volB = Volume(b.size);
                    Bounds overlap = Intersection(a, b);
                    float ratio = Volume(overlap.size) / Mathf.Min(volA, volB);
                    if (ratio < volumeRatioThreshold) continue;

                    findings.Add(new Finding
                    {
                        aPath = Path(colliders[i].transform),
                        bPath = Path(colliders[j].transform),
                        centre = overlap.center,
                        volumeRatio = ratio,
                    });
                }
            }

            return findings.OrderByDescending(f => f.volumeRatio).ToList();
        }

        private static bool SameGroup(Transform a, Transform b)
        {
            string ga = GroupOf(a), gb = GroupOf(b);
            if (ga == null || gb == null) return false;
            return ga == gb;
        }

        private static string GroupOf(Transform t)
        {
            var marker = t.GetComponentInParent<WorldsmithInstance>();
            return marker == null ? null : marker.groupId;
        }

        private static float Volume(Vector3 size) =>
            Mathf.Max(0f, size.x) * Mathf.Max(0f, size.y) * Mathf.Max(0f, size.z);

        private static Bounds Intersection(Bounds a, Bounds b)
        {
            Vector3 min = Vector3.Max(a.min, b.min);
            Vector3 max = Vector3.Min(a.max, b.max);
            var result = new Bounds();
            result.SetMinMax(min, Vector3.Max(min, max));
            return result;
        }

        private static string Path(Transform t)
        {
            var parts = new List<string>();
            for (Transform cur = t; cur != null; cur = cur.parent) parts.Add(cur.name);
            parts.Reverse();
            return string.Join("/", parts);
        }
    }
}
