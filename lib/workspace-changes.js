/**
 * Phase 5A — Granular change detection for shared Studio documents.
 * Full workspace_data.document remains authoritative.
 * Change metadata is supplementary (realtime, versions, activity).
 *
 * Safe grain: project / production (+ script|shotlist|references|assets subtypes).
 * Does NOT invent shot-/line-level events (no reliable nested timestamps).
 */
export const CHANGE_TYPES = [
  'project.created',
  'project.updated',
  'project.deleted',
  'production.created',
  'production.updated',
  'production.deleted',
  'script.updated',
  'shotlist.updated',
  'references.updated',
  'assets.updated',
  'workspace.restored',
  'workspace.updated'
];

const MAX_CHANGES = 12;

function projectsOf(doc) {
  if (!doc || typeof doc !== 'object') return [];
  return Array.isArray(doc.projects) ? doc.projects.filter((p) => p && p.id) : [];
}

function productionsOf(project) {
  return Array.isArray(project && project.productions)
    ? project.productions.filter((p) => p && p.id)
    : [];
}

function mapById(list) {
  const m = new Map();
  for (let i = 0; i < list.length; i++) m.set(String(list[i].id), list[i]);
  return m;
}

function stableJson(value) {
  try {
    return JSON.stringify(value == null ? null : value);
  } catch (e) {
    return '';
  }
}

function scriptFingerprint(ws) {
  const s = (ws && ws.script) || {};
  return stableJson({
    body: s.body || '',
    lines: Array.isArray(s.lines) ? s.lines : []
  });
}

function shotlistFingerprint(ws) {
  const shots = (ws && ws.shotList) || [];
  return stableJson(Array.isArray(shots) ? shots : []);
}

function referencesFingerprint(ws) {
  const r = (ws && ws.references) || {};
  const slim = {
    youtube: r.youtube,
    capcut: r.capcut,
    uploads: r.uploads,
    other: r.other,
    pinterest: r.pinterest
  };
  return stableJson(slim);
}

function assetsFingerprint(ws) {
  const assets = (ws && ws.assets) || [];
  if (!Array.isArray(assets)) return '[]';
  return stableJson(
    assets.map((a) => ({
      id: a && a.id,
      name: a && a.name,
      storagePath: a && a.storagePath,
      src: a && (a.src || a.url) ? true : false,
      size: a && a.size
    }))
  );
}

function productionShellFingerprint(prod) {
  return stableJson({
    name: prod && prod.name,
    notes: prod && prod.notes,
    status: prod && prod.status,
    progress: prod && prod.progress,
    archived: !!(prod && prod.archived),
    coverImage: prod && prod.coverImage ? true : false,
    overview: prod && prod.workspace && prod.workspace.overview
  });
}

function projectShellFingerprint(proj) {
  return stableJson({
    name: proj && proj.name,
    notes: proj && proj.notes,
    archived: !!(proj && proj.archived),
    coverImage: proj && proj.coverImage ? true : false
  });
}

function pushChange(out, change) {
  if (!change || !change.type) return;
  if (out.length >= MAX_CHANGES) return;
  out.push(change);
}

/**
 * Diff before → after documents. Returns ordered change list (most specific first).
 */
export function detectDocumentChanges(beforeDoc, afterDoc, opts) {
  opts = opts || {};
  const changes = [];
  const before = mapById(projectsOf(beforeDoc));
  const after = mapById(projectsOf(afterDoc));

  /* Project deletes */
  for (const [id, proj] of before) {
    if (!after.has(id)) {
      pushChange(changes, {
        type: 'project.deleted',
        projectId: id,
        entityId: id,
        entityLabel: proj.name || 'Untitled project'
      });
    }
  }

  /* Project creates + updates */
  for (const [id, proj] of after) {
    const prev = before.get(id);
    if (!prev) {
      pushChange(changes, {
        type: 'project.created',
        projectId: id,
        entityId: id,
        entityLabel: proj.name || 'Untitled project'
      });
      const prods = productionsOf(proj);
      for (let i = 0; i < prods.length; i++) {
        pushChange(changes, {
          type: 'production.created',
          projectId: id,
          productionId: prods[i].id,
          entityId: prods[i].id,
          entityLabel: prods[i].name || 'Untitled production'
        });
      }
      continue;
    }

    if (projectShellFingerprint(prev) !== projectShellFingerprint(proj)) {
      pushChange(changes, {
        type: 'project.updated',
        projectId: id,
        entityId: id,
        entityLabel: proj.name || prev.name || 'Untitled project'
      });
    }

    const prevProds = mapById(productionsOf(prev));
    const nextProds = mapById(productionsOf(proj));

    for (const [pid, prod] of prevProds) {
      if (!nextProds.has(pid)) {
        pushChange(changes, {
          type: 'production.deleted',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || 'Untitled production'
        });
      }
    }

    for (const [pid, prod] of nextProds) {
      const prevProd = prevProds.get(pid);
      if (!prevProd) {
        pushChange(changes, {
          type: 'production.created',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || 'Untitled production'
        });
        continue;
      }

      const pws = prevProd.workspace || {};
      const nws = prod.workspace || {};
      let specific = false;

      if (scriptFingerprint(pws) !== scriptFingerprint(nws)) {
        specific = true;
        pushChange(changes, {
          type: 'script.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      }
      if (shotlistFingerprint(pws) !== shotlistFingerprint(nws)) {
        specific = true;
        pushChange(changes, {
          type: 'shotlist.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      }
      if (referencesFingerprint(pws) !== referencesFingerprint(nws)) {
        specific = true;
        pushChange(changes, {
          type: 'references.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      }
      if (assetsFingerprint(pws) !== assetsFingerprint(nws)) {
        specific = true;
        pushChange(changes, {
          type: 'assets.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      }

      if (!specific && productionShellFingerprint(prevProd) !== productionShellFingerprint(prod)) {
        pushChange(changes, {
          type: 'production.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      } else if (
        !specific &&
        stableJson(prevProd.workspace) !== stableJson(prod.workspace)
      ) {
        /* Catch-all production workspace mutation without inventing fake subtypes */
        pushChange(changes, {
          type: 'production.updated',
          projectId: id,
          productionId: pid,
          entityId: pid,
          entityLabel: prod.name || prevProd.name || 'Untitled production'
        });
      }
    }
  }

  if (!changes.length) {
    pushChange(changes, {
      type: opts.reason === 'restore' ? 'workspace.restored' : 'workspace.updated',
      entityId: null,
      entityLabel: null
    });
  }

  return changes;
}

/**
 * Pick a single primary change for compact realtime / version rows.
 * Prefer specific production subtypes over generic workspace.updated.
 */
export function primaryChange(changes) {
  if (!Array.isArray(changes) || !changes.length) {
    return {
      type: 'workspace.updated',
      projectId: null,
      productionId: null,
      entityId: null,
      entityLabel: null
    };
  }
  const priority = [
    'workspace.restored',
    'project.deleted',
    'production.deleted',
    'project.created',
    'production.created',
    'script.updated',
    'shotlist.updated',
    'references.updated',
    'assets.updated',
    'production.updated',
    'project.updated',
    'workspace.updated'
  ];
  for (let i = 0; i < priority.length; i++) {
    const hit = changes.find((c) => c && c.type === priority[i]);
    if (hit) return normalizeChange(hit);
  }
  return normalizeChange(changes[0]);
}

export function normalizeChange(raw) {
  const type = CHANGE_TYPES.includes(raw && raw.type) ? raw.type : 'workspace.updated';
  return {
    type,
    projectId: raw && raw.projectId ? String(raw.projectId) : null,
    productionId: raw && raw.productionId ? String(raw.productionId) : null,
    entityId: raw && raw.entityId ? String(raw.entityId) : null,
    entityLabel: raw && raw.entityLabel ? String(raw.entityLabel).slice(0, 120) : null
  };
}

/**
 * Validate client-provided change hint against the after document.
 * Never trust client IDs that are absent from the saved document (except deletes).
 */
export function reconcileClientChangeHint(hint, beforeDoc, afterDoc, detected) {
  const primary = primaryChange(detected);
  if (!hint || typeof hint !== 'object') return primary;

  const type = CHANGE_TYPES.includes(hint.type) ? hint.type : null;
  if (!type) return primary;

  /* Prefer server detection when it already found specific changes */
  if (primary.type !== 'workspace.updated' && primary.type !== 'workspace.restored') {
    /* If client hint matches a detected change type for same entity, keep detected labels */
    const match = (detected || []).find(
      (c) =>
        c.type === type &&
        (!hint.productionId || String(c.productionId) === String(hint.productionId)) &&
        (!hint.projectId || String(c.projectId) === String(hint.projectId))
    );
    if (match) return normalizeChange(match);
    return primary;
  }

  /* Server saw only generic update — allow verified client hint */
  const projectId = hint.projectId ? String(hint.projectId) : null;
  const productionId = hint.productionId ? String(hint.productionId) : null;
  const afterProjects = mapById(projectsOf(afterDoc));
  const beforeProjects = mapById(projectsOf(beforeDoc));

  if (type.startsWith('project.') && projectId) {
    const existsAfter = afterProjects.has(projectId);
    const existsBefore = beforeProjects.has(projectId);
    if (type === 'project.deleted' && existsBefore && !existsAfter) {
      return normalizeChange({
        type,
        projectId,
        entityId: projectId,
        entityLabel: hint.entityLabel || beforeProjects.get(projectId).name
      });
    }
    if (type !== 'project.deleted' && existsAfter) {
      return normalizeChange({
        type,
        projectId,
        entityId: projectId,
        entityLabel: hint.entityLabel || afterProjects.get(projectId).name
      });
    }
    return primary;
  }

  if (productionId) {
    let foundAfter = null;
    let foundBefore = null;
    let projectAfter = null;
    for (const [pid, proj] of afterProjects) {
      const hit = productionsOf(proj).find((p) => String(p.id) === productionId);
      if (hit) {
        foundAfter = hit;
        projectAfter = pid;
        break;
      }
    }
    for (const [, proj] of beforeProjects) {
      const hit = productionsOf(proj).find((p) => String(p.id) === productionId);
      if (hit) {
        foundBefore = hit;
        break;
      }
    }
    if (type === 'production.deleted' && foundBefore && !foundAfter) {
      return normalizeChange({
        type,
        projectId: projectId || null,
        productionId,
        entityId: productionId,
        entityLabel: hint.entityLabel || foundBefore.name
      });
    }
    if (type !== 'production.deleted' && foundAfter) {
      return normalizeChange({
        type,
        projectId: projectId || projectAfter,
        productionId,
        entityId: productionId,
        entityLabel: hint.entityLabel || foundAfter.name
      });
    }
  }

  return primary;
}

export function changeActivityLabel(change) {
  const c = normalizeChange(change || {});
  const name = c.entityLabel ? `"${c.entityLabel}"` : null;
  switch (c.type) {
    case 'project.created':
      return name ? `created project ${name}` : 'created a project';
    case 'project.updated':
      return name ? `updated project ${name}` : 'updated a project';
    case 'project.deleted':
      return name ? `deleted project ${name}` : 'deleted a project';
    case 'production.created':
      return name ? `created ${name}` : 'created a production';
    case 'production.updated':
      return name ? `updated ${name}` : 'updated a production';
    case 'production.deleted':
      return name ? `deleted ${name}` : 'deleted a production';
    case 'script.updated':
      return name ? `updated the script for ${name}` : 'updated a script';
    case 'shotlist.updated':
      return name ? `updated the shot list for ${name}` : 'updated a shot list';
    case 'references.updated':
      return name ? `updated references for ${name}` : 'updated references';
    case 'assets.updated':
      return name ? `updated assets for ${name}` : 'updated assets';
    case 'workspace.restored':
      return 'restored a previous version';
    default:
      return 'updated the workspace';
  }
}

export function changeTypeLabel(type) {
  switch (type) {
    case 'project.created':
      return 'Project created';
    case 'project.updated':
      return 'Project updated';
    case 'project.deleted':
      return 'Project deleted';
    case 'production.created':
      return 'Production created';
    case 'production.updated':
      return 'Production updated';
    case 'production.deleted':
      return 'Production deleted';
    case 'script.updated':
      return 'Script updated';
    case 'shotlist.updated':
      return 'Shot list updated';
    case 'references.updated':
      return 'References updated';
    case 'assets.updated':
      return 'Assets updated';
    case 'workspace.restored':
      return 'Version restored';
    default:
      return 'Workspace updated';
  }
}

/**
 * Same-entity conflict: remote change targets the production/project the user is editing.
 */
export function isSameEntityConflict(localContext, remoteChange) {
  if (!localContext || !remoteChange) return false;
  const rc = normalizeChange(remoteChange);
  const activeProd = localContext.activeProductionId
    ? String(localContext.activeProductionId)
    : null;
  const activeProj = localContext.activeProjectId
    ? String(localContext.activeProjectId)
    : null;

  if (activeProd && rc.productionId && activeProd === String(rc.productionId)) return true;
  if (
    activeProj &&
    rc.projectId &&
    activeProj === String(rc.projectId) &&
    !rc.productionId &&
    (rc.type || '').startsWith('project.')
  ) {
    return true;
  }
  return false;
}
