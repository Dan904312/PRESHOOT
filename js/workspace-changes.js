/**
 * Phase 5A client change helpers — mirrors lib/workspace-changes.js for browser.
 * Full document remains authoritative; metadata is supplementary.
 */
(function (global) {
  'use strict';

  function projectsOf(doc) {
    if (!doc || typeof doc !== 'object') return [];
    return Array.isArray(doc.projects) ? doc.projects.filter(function (p) { return p && p.id; }) : [];
  }
  function productionsOf(project) {
    return Array.isArray(project && project.productions)
      ? project.productions.filter(function (p) { return p && p.id; })
      : [];
  }
  function mapById(list) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[String(list[i].id)] = list[i];
    return m;
  }
  function stableJson(value) {
    try {
      return JSON.stringify(value == null ? null : value);
    } catch (e) {
      return '';
    }
  }
  function scriptFp(ws) {
    var s = (ws && ws.script) || {};
    return stableJson({ body: s.body || '', lines: Array.isArray(s.lines) ? s.lines : [] });
  }
  function shotFp(ws) {
    return stableJson((ws && ws.shotList) || []);
  }
  function refsFp(ws) {
    var r = (ws && ws.references) || {};
    return stableJson({
      youtube: r.youtube,
      capcut: r.capcut,
      uploads: r.uploads,
      other: r.other,
      pinterest: r.pinterest
    });
  }
  function assetsFp(ws) {
    var assets = (ws && ws.assets) || [];
    if (!Array.isArray(assets)) return '[]';
    return stableJson(
      assets.map(function (a) {
        return {
          id: a && a.id,
          name: a && a.name,
          storagePath: a && a.storagePath,
          size: a && a.size
        };
      })
    );
  }

  function detectDocumentChanges(beforeDoc, afterDoc) {
    var changes = [];
    var before = mapById(projectsOf(beforeDoc));
    var after = mapById(projectsOf(afterDoc));
    function push(c) {
      if (changes.length < 12) changes.push(c);
    }
    Object.keys(before).forEach(function (id) {
      if (!after[id]) {
        push({
          type: 'project.deleted',
          projectId: id,
          entityId: id,
          entityLabel: before[id].name || 'Untitled project'
        });
      }
    });
    Object.keys(after).forEach(function (id) {
      var proj = after[id];
      var prev = before[id];
      if (!prev) {
        push({
          type: 'project.created',
          projectId: id,
          entityId: id,
          entityLabel: proj.name || 'Untitled project'
        });
        return;
      }
      var prevProds = mapById(productionsOf(prev));
      var nextProds = mapById(productionsOf(proj));
      Object.keys(prevProds).forEach(function (pid) {
        if (!nextProds[pid]) {
          push({
            type: 'production.deleted',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prevProds[pid].name || 'Untitled production'
          });
        }
      });
      Object.keys(nextProds).forEach(function (pid) {
        var prod = nextProds[pid];
        var prevProd = prevProds[pid];
        if (!prevProd) {
          push({
            type: 'production.created',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
          return;
        }
        var pws = prevProd.workspace || {};
        var nws = prod.workspace || {};
        if (scriptFp(pws) !== scriptFp(nws)) {
          push({
            type: 'script.updated',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
        } else if (shotFp(pws) !== shotFp(nws)) {
          push({
            type: 'shotlist.updated',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
        } else if (refsFp(pws) !== refsFp(nws)) {
          push({
            type: 'references.updated',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
        } else if (assetsFp(pws) !== assetsFp(nws)) {
          push({
            type: 'assets.updated',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
        } else if (stableJson(prevProd) !== stableJson(prod)) {
          push({
            type: 'production.updated',
            projectId: id,
            productionId: pid,
            entityId: pid,
            entityLabel: prod.name || 'Untitled production'
          });
        }
      });
      if (
        String(prev.name || '') !== String(proj.name || '') ||
        String(prev.notes || '') !== String(proj.notes || '')
      ) {
        push({
          type: 'project.updated',
          projectId: id,
          entityId: id,
          entityLabel: proj.name || 'Untitled project'
        });
      }
    });
    if (!changes.length) {
      push({ type: 'workspace.updated', entityId: null, entityLabel: null });
    }
    return changes;
  }

  function primaryChange(changes) {
    if (!changes || !changes.length) return { type: 'workspace.updated' };
    var priority = [
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
    for (var i = 0; i < priority.length; i++) {
      for (var j = 0; j < changes.length; j++) {
        if (changes[j] && changes[j].type === priority[i]) return changes[j];
      }
    }
    return changes[0];
  }

  function changeTypeLabel(type) {
    var map = {
      'project.created': 'Project created',
      'project.updated': 'Project updated',
      'project.deleted': 'Project deleted',
      'production.created': 'Production created',
      'production.updated': 'Production updated',
      'production.deleted': 'Production deleted',
      'script.updated': 'Script updated',
      'shotlist.updated': 'Shot list updated',
      'references.updated': 'References updated',
      'assets.updated': 'Assets updated',
      'workspace.restored': 'Version restored',
      'workspace.updated': 'Workspace updated'
    };
    return map[type] || 'Workspace updated';
  }

  function isSameEntityConflict(localContext, remoteChange) {
    if (!localContext || !remoteChange) return false;
    var activeProd = localContext.activeProductionId
      ? String(localContext.activeProductionId)
      : null;
    var activeProj = localContext.activeProjectId
      ? String(localContext.activeProjectId)
      : null;
    var rp = remoteChange.productionId || remoteChange.production_id;
    var rj = remoteChange.projectId || remoteChange.project_id;
    if (activeProd && rp && activeProd === String(rp)) return true;
    if (
      activeProj &&
      rj &&
      activeProj === String(rj) &&
      !rp &&
      String(remoteChange.type || '').indexOf('project.') === 0
    ) {
      return true;
    }
    return false;
  }

  function editingContextFromStudio() {
    var view = global.S && global.S.studioView;
    if (!view) return { activeProjectId: null, activeProductionId: null, activeEntity: null };
    if (view.mode === 'production' && view.productionId) {
      return {
        activeProjectId: view.projectId || null,
        activeProductionId: view.productionId,
        activeEntity: 'production'
      };
    }
    if (view.mode === 'project' && view.projectId) {
      return {
        activeProjectId: view.projectId,
        activeProductionId: null,
        activeEntity: 'project'
      };
    }
    return {
      activeProjectId: view.projectId || null,
      activeProductionId: view.productionId || null,
      activeEntity: null
    };
  }

  global.PreShootWorkspaceChanges = {
    detectDocumentChanges: detectDocumentChanges,
    primaryChange: primaryChange,
    changeTypeLabel: changeTypeLabel,
    isSameEntityConflict: isSameEntityConflict,
    editingContextFromStudio: editingContextFromStudio
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
