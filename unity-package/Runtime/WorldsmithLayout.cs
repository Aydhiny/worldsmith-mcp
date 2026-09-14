using System;
using System.Collections.Generic;

namespace Worldsmith
{
    /// <summary>
    /// C# mirror of server/src/schema.ts's LevelLayout. Kept in lockstep BY HAND, not generated —
    /// there is no codegen step in v0.1. If you add a field on one side, add it on the other; the
    /// JSON property names must match exactly since this is deserialized with JsonUtility, which
    /// matches fields by NAME and silently leaves unmatched ones at their C# default rather than
    /// erroring. That silence is exactly the failure class this whole project exists to prevent,
    /// so treat a schema change on either side as a two-file change, always.
    /// </summary>
    [Serializable]
    public class Vec3Data
    {
        public float x, y, z;

        public UnityEngine.Vector3 ToUnity() => new UnityEngine.Vector3(x, y, z);
    }

    [Serializable]
    public class AABBData
    {
        public Vec3Data center;
        public Vec3Data size;
    }

    [Serializable]
    public class PlacementData
    {
        public string id;
        /// <summary>"block" | "prop" | "enemy" | "collectible" | "hazard" | "checkpoint"</summary>
        public string kind;
        public string name;
        public Vec3Data position;
        public float rotationY;
        public Vec3Data size;
        public string prefabRef;
        /// <summary>Defaults to true, matching the TS schema's default. JsonUtility only
        /// overwrites fields actually present in the source JSON, so a layout that omits
        /// "solid" correctly leaves this at its true default rather than silently becoming
        /// non-solid the way a bare `bool` default (false) would.</summary>
        public bool solid = true;
        public List<string> tags = new List<string>();
        public string groupId;
    }

    [Serializable]
    public class ZoneData
    {
        public string id;
        public AABBData bounds;
        public List<string> placementIds = new List<string>();
    }

    [Serializable]
    public class MovementProfileData
    {
        public float gravity;
        public float jumpHeight;
        public float runSpeed;
        public float maxRisePerStep;
        public int jumpsAvailable = 1;
    }

    [Serializable]
    public class LevelLayoutData
    {
        public string id;
        public List<ZoneData> zones = new List<ZoneData>();
        public List<PlacementData> placements = new List<PlacementData>();
        public Vec3Data spawn;
        public MovementProfileData movement;
    }
}
