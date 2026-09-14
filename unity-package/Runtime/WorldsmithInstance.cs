using UnityEngine;

namespace Worldsmith
{
    /// <summary>
    /// Marks the root GameObject of one placed instance and carries its groupId forward into the
    /// live scene, so the live-scene audit can apply the exact same "siblings are expected to
    /// touch, only cross-instance overlaps are bugs" rule the pure-JSON validator already
    /// applied — WITHOUT reintroducing a naming-convention dependency (Puntsy's original tool
    /// grouped by walking up to the nearest ancestor named "---Something---", which only works
    /// inside a project that already follows that specific hierarchy convention).
    /// </summary>
    public class WorldsmithInstance : MonoBehaviour
    {
        public string placementId;
        public string groupId;
        public bool solid = true;
    }
}
