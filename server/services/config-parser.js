"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Parses and validates `infraxis.yml` or `.infraxis.yml` files.
 * Supports standard YAML structure (nested objects, lists, strings, booleans, numbers)
 * as well as JSON syntax.
 */

function parseSimpleYaml(content) {
  if (!content || !content.trim()) return {};
  // If JSON, parse directly
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  const lines = content.split("\n");
  const root = {};
  const stack = [{ indent: -1, obj: root, isArray: false }];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const stripped = rawLine.replace(/#.*$/, "").trimEnd();
    if (!stripped.trim()) continue;

    const indent = rawLine.search(/\S/);
    const line = stripped.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1];

    if (line.startsWith("- ")) {
      // List item
      const itemContent = line.slice(2).trim();
      const parentObj = current.obj;
      let targetArray = current.isArray ? parentObj : null;

      if (!targetArray) {
        // Find or create array in parent
        const lastKey = current.lastKey;
        if (lastKey && Array.isArray(parentObj[lastKey])) {
          targetArray = parentObj[lastKey];
        } else if (lastKey) {
          targetArray = [];
          parentObj[lastKey] = targetArray;
        } else {
          continue;
        }
      }

      if (itemContent.includes(":") && !itemContent.startsWith("http:") && !itemContent.startsWith("https:")) {
        // List item is an object: e.g. - name: Lint
        const colonIdx = itemContent.indexOf(":");
        const k = itemContent.slice(0, colonIdx).trim();
        const v = parseValue(itemContent.slice(colonIdx + 1).trim());
        const newObj = { [k]: v };
        targetArray.push(newObj);
        stack.push({ indent, obj: newObj, isArray: false, lastKey: k });
      } else {
        targetArray.push(parseValue(itemContent));
      }
    } else if (line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();

      if (!valStr) {
        // Section / nested object or list start
        const nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
        if (nextLine.startsWith("- ")) {
          const arr = [];
          current.obj[key] = arr;
          stack.push({ indent, obj: arr, isArray: true, lastKey: key });
        } else {
          const newObj = {};
          current.obj[key] = newObj;
          stack.push({ indent, obj: newObj, isArray: false, lastKey: key });
        }
      } else {
        current.obj[key] = parseValue(valStr);
        current.lastKey = key;
      }
    }
  }

  return root;
}

function parseValue(val) {
  if (val === "" || val === "null" || val === "~") return null;
  if (val === "true" || val === "yes") return true;
  if (val === "false" || val === "no") return false;
  if (!isNaN(val) && val !== "") return Number(val);
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * Validate and normalize configuration
 */
function validateConfig(config) {
  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Configuration must be an object"], config: null };
  }

  const errors = [];
  const normalized = {
    version: String(config.version || "1.0"),
    name: config.name || "unnamed-project",
    projectType: config.projectType || config.project_type || "auto",
    pipelines: {},
    env: typeof config.env === "object" && config.env !== null ? config.env : {},
    artifacts: Array.isArray(config.artifacts) ? config.artifacts : [],
  };

  if (config.pipelines && typeof config.pipelines === "object") {
    for (const [profileName, profileData] of Object.entries(config.pipelines)) {
      if (typeof profileData !== "object" || profileData === null) continue;
      const stages = Array.isArray(profileData.stages) ? profileData.stages : [];
      normalized.pipelines[profileName] = {
        name: profileData.name || profileName,
        requiredCapabilities: Array.isArray(profileData.requiredCapabilities)
          ? profileData.requiredCapabilities
          : (Array.isArray(profileData.capabilities) ? profileData.capabilities : []),
        timeoutSeconds: Number(profileData.timeoutSeconds || profileData.timeout || 3600),
        env: typeof profileData.env === "object" ? profileData.env : {},
        stages: stages.map((st, idx) => ({
          name: st.name || `Stage ${idx + 1}`,
          category: st.category || "custom",
          command: st.command || st.run || st.script || "",
          dir: st.dir || st.cwd || ".",
          allowFailure: Boolean(st.allowFailure || st.continueOnError),
          env: typeof st.env === "object" ? st.env : {},
        })),
        artifacts: Array.isArray(profileData.artifacts) ? profileData.artifacts : [],
      };
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    config: normalized,
  };
}

/**
 * Load config from a directory if it exists
 */
function loadRepoConfig(repoDir) {
  const possiblePaths = [
    path.join(repoDir, "infraxis.yml"),
    path.join(repoDir, "infraxis.yaml"),
    path.join(repoDir, ".infraxis.yml"),
    path.join(repoDir, ".infraxis.yaml"),
    path.join(repoDir, "infraxis.json"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = parseSimpleYaml(raw);
        const { valid, errors, config } = validateConfig(parsed);
        if (valid) return config;
      } catch {}
    }
  }
  return null;
}

module.exports = {
  parseSimpleYaml,
  parseInfraxisConfig: parseSimpleYaml,
  validateConfig,
  loadRepoConfig,
};
