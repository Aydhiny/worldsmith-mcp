using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Worldsmith.Editor
{
    /// <summary>
    /// Consumes an ALREADY-VALIDATED LevelLayout JSON and instantiates it. This is the "builder"
    /// stage of the three-stage pipeline (generate data -> validate -> build) — it does the
    /// minimum necessary to turn a layout into real GameObjects and nothing more. It does not
    /// decide where anything goes; that decision was made by whatever produced the JSON and was
    /// checked by worldsmith-mcp's validate_layout tool BEFORE this ever runs.
    ///
    /// THIS TRUSTS THE INPUT. Running it against a layout that was never validated is exactly the
    /// mistake this whole project exists to prevent — there is no code path here that re-derives
    /// "is this actually a good layout", on purpose, because that logic already exists once (in
    /// the TypeScript validators) and a second copy is a thing that drifts.
    ///
    /// What it DOES do for you, as a safety net rather than a substitute for validation: after
    /// building, it runs <see cref="WorldsmithOverlapAudit"/> against the live scene and logs a
    /// loud warning (not a silent pass) if anything still interpenetrates — the same
    /// belt-and-braces "pre-build math AND post-build live check" pairing that caught bugs
    /// neither layer alone would have (a same-frame PhysX sync issue only the live check could
    /// see; an organic-terrain sprawl only the pre-build zone check could see cheaply).
    /// </summary>
    public static class WorldsmithBuilder
    {
        [MenuItem("Tools/Worldsmith/Build Layout From JSON...")]
        public static void BuildFromDialog()
        {
            string path = EditorUtility.OpenFilePanel("Select a validated LevelLayout JSON", Application.dataPath, "json");
            if (string.IsNullOrEmpty(path)) return;
            Build(path);
        }

        public static GameObject Build(string jsonPath)
        {
            string json = File.ReadAllText(jsonPath);
            LevelLayoutData layout = JsonUtility.FromJson<LevelLayoutData>(json);

            if (layout == null || layout.placements == null)
            {
                Debug.LogError($"[Worldsmith] '{jsonPath}' did not parse as a LevelLayout.");
                return null;
            }

            var root = new GameObject($"Worldsmith_{layout.id}");
            var byId = new Dictionary<string, GameObject>();

            foreach (PlacementData p in layout.placements)
            {
                GameObject go = Instantiate(p, root.transform);
                if (go == null) continue;

                var marker = go.GetComponent<WorldsmithInstance>();
                if (marker == null) marker = go.AddComponent<WorldsmithInstance>();
                marker.placementId = p.id;
                marker.groupId = string.IsNullOrEmpty(p.groupId) ? p.id : p.groupId;
                marker.solid = p.solid;

                foreach (Collider col in go.GetComponentsInChildren<Collider>())
                    col.isTrigger = !p.solid;

                byId[p.id] = go;
            }

            Debug.Log($"[Worldsmith] Built '{layout.id}': {byId.Count} placement(s).");

            var findings = WorldsmithOverlapAudit.Audit(root.transform);
            if (findings.Count > 0)
            {
                Debug.LogWarning($"[Worldsmith] {findings.Count} interpenetrating pair(s) found AFTER " +
                                 "build. This layout should have been rejected by validate_layout before " +
                                 "reaching the builder — treat this as a bug in the validation step, or " +
                                 "confirmation this layout was never actually validated:");
                foreach (WorldsmithOverlapAudit.Finding f in findings)
                    Debug.LogWarning($"[Worldsmith]   {f.aPath}  x  {f.bPath}  ({f.volumeRatio * 100f:F0}%)");
            }

            return root;
        }

        private static GameObject Instantiate(PlacementData p, Transform parent)
        {
            GameObject go;
            bool isPlaceholderPrimitive = true;

            if (!string.IsNullOrEmpty(p.prefabRef))
            {
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(p.prefabRef);
                if (prefab == null)
                {
                    Debug.LogWarning($"[Worldsmith] Placement '{p.id}': prefabRef '{p.prefabRef}' did not " +
                                     "resolve via AssetDatabase. Falling back to a placeholder cube so the " +
                                     "layout's SHAPE is still visible for review.");
                    go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                }
                else
                {
                    go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
                    isPlaceholderPrimitive = false;
                }
            }
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            }

            go.name = string.IsNullOrEmpty(p.name) ? p.id : p.name;
            go.transform.SetParent(parent, false);
            go.transform.position = p.position.ToUnity();
            go.transform.rotation = Quaternion.Euler(0f, p.rotationY, 0f);

            // Only placeholder primitives get scaled to the placement's size — a real prefab's
            // authored size is presumed correct and re-scaling it to an arbitrary AABB would
            // distort it. Placements without a resolvable prefabRef (raw "block" geometry, or a
            // failed prefab lookup) use the placement's size directly as the cube's dimensions.
            if (isPlaceholderPrimitive) go.transform.localScale = p.size.ToUnity();

            return go;
        }
    }
}
