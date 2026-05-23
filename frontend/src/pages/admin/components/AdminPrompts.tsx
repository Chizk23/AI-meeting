import React from 'react';
import { Save, History, FlaskConical, Undo2, Play } from 'lucide-react';
import api from '../../../services/api';
import { toast } from '../../../components/ui/Toast';

type PromptItem = {
  key: string;
  name: string;
  description?: string;
  content: string;
  version?: string;
  last_updated?: string;
};

type PromptVersion = {
  id: string;
  prompt_key: string;
  name: string;
  description?: string;
  content: string;
  version: string;
  created_at: string;
  created_by?: string;
};

const AdminPrompts: React.FC = () => {
  const [prompts, setPrompts] = React.useState<PromptItem[]>([]);
  const [selectedKey, setSelectedKey] = React.useState('');
  const [content, setContent] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  // P2 #19 — version history + rollback
  const [versions, setVersions] = React.useState<PromptVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = React.useState(false);

  // P2 #19 — prompt playground (test against sample text)
  const [sampleText, setSampleText] = React.useState('');
  const [testOutput, setTestOutput] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);

  const selectedPrompt = prompts.find((item) => item.key === selectedKey);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/admin/prompts');
      const rows = Array.isArray(response.data) ? response.data : [];
      setPrompts(rows);
      if (rows.length > 0) {
        setSelectedKey(rows[0].key);
        setName(rows[0].name || '');
        setDescription(rows[0].description || '');
        setContent(rows[0].content || '');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Khong tai duoc danh sach prompt');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVersions = React.useCallback(async (key: string) => {
    if (!key) {
      setVersions([]);
      return;
    }
    setVersionsLoading(true);
    try {
      const response = await api.get(`/api/admin/prompts/${key}/versions`);
      setVersions(Array.isArray(response.data) ? response.data : []);
    } catch {
      // 404 from new keys is fine — they just have no history yet
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    loadVersions(selectedKey);
    setTestOutput(null);
  }, [selectedKey, loadVersions]);

  const handleSelectPrompt = (item: PromptItem) => {
    setSelectedKey(item.key);
    setName(item.name || '');
    setDescription(item.description || '');
    setContent(item.content || '');
  };

  const handleSave = async () => {
    if (!selectedKey) return;
    setSaving(true);
    try {
      const payload = {
        key: selectedKey,
        name,
        description,
        content,
        version: selectedPrompt?.version,
      };
      const response = await api.put(`/api/admin/prompts/${selectedKey}`, payload);
      const updated = response.data as PromptItem;
      setPrompts((current) => current.map((item) => (item.key === selectedKey ? updated : item)));
      toast.success('Da cap nhat prompt');
      // Reload versions so the snapshot we just created shows up.
      loadVersions(selectedKey);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Khong cap nhat duoc prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    if (!selectedKey) return;
    if (!window.confirm('Khoi phuc prompt ve phien ban nay? Phien ban hien tai se duoc snapshot truoc.')) {
      return;
    }
    try {
      const response = await api.post(`/api/admin/prompts/${selectedKey}/rollback`, { version_id: versionId });
      const updated = response.data as PromptItem;
      setPrompts((current) => current.map((item) => (item.key === selectedKey ? updated : item)));
      setName(updated.name || '');
      setDescription(updated.description || '');
      setContent(updated.content || '');
      toast.success('Da rollback prompt');
      loadVersions(selectedKey);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Khong rollback duoc');
    }
  };

  const handleTest = async () => {
    if (!selectedKey || !sampleText.trim()) return;
    setTesting(true);
    setTestOutput(null);
    try {
      const response = await api.post(`/api/admin/prompts/${selectedKey}/test`, { sample_text: sampleText });
      const out = response.data?.output;
      setTestOutput(out ?? '(empty response)');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Khong test duoc prompt');
      setTestOutput(null);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Dang tai system prompts...</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-4">
        <h3 className="px-1 text-xs font-black uppercase tracking-widest text-gray-400">System Prompts</h3>
        {error && <p className="text-sm font-semibold text-red-500">{error}</p>}
        {prompts.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => handleSelectPrompt(item)}
            className={`w-full rounded-2xl border p-4 text-left transition ${
              selectedKey === item.key
                ? 'border-red-400 bg-red-50/40 dark:bg-red-900/10'
                : 'border-gray-100 bg-white hover:border-gray-300 dark:border-slate-800 dark:bg-slate-900'
            }`}
          >
            <p className="text-sm font-black text-gray-900 dark:text-slate-100">{item.name}</p>
            <p className="mt-1 text-xs text-gray-500">{item.description || 'No description'}</p>
            <p className="mt-2 text-[10px] font-bold text-gray-400">{item.key}</p>
          </button>
        ))}
      </div>

      <div className="lg:col-span-8 space-y-6">
        {/* Editor */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Ten prompt</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-500">Version</label>
              <input
                value={selectedPrompt?.version || ''}
                disabled
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-bold text-gray-500">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-bold text-gray-500">Prompt content</label>
            <textarea
              rows={14}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !selectedKey}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Save size={16} />
              {saving ? 'Dang luu...' : 'Luu prompt'}
            </button>
          </div>
        </div>

        {/* Prompt playground (P2 #19) */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-purple-50 p-2 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
              <FlaskConical size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900 dark:text-slate-100">Playground</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">Test prompt voi transcript mau truoc khi luu</p>
            </div>
          </div>
          <textarea
            rows={5}
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder="Dan transcript mau vao day..."
            className="w-full rounded-xl border border-gray-200 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !sampleText.trim() || !selectedKey}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-black text-white hover:bg-purple-700 disabled:opacity-60"
            >
              <Play size={16} />
              {testing ? 'Dang chay...' : 'Chay test'}
            </button>
          </div>
          {testOutput !== null && (
            <div className="mt-4">
              <label className="mb-1 block text-xs font-bold text-gray-500">Output</label>
              <pre className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {testOutput}
              </pre>
            </div>
          )}
        </div>

        {/* Version history (P2 #19) */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
              <History size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900 dark:text-slate-100">Lich su phien ban</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">Moi lan luu se tao 1 snapshot. Co the rollback bat ky version nao.</p>
            </div>
          </div>
          {versionsLoading ? (
            <p className="text-sm text-gray-500">Dang tai lich su...</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Chua co phien ban nao trong lich su. Luu prompt mot lan de tao snapshot dau tien.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-gray-100 p-3 dark:border-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900 dark:text-slate-100">v{v.version}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        {v.created_at?.slice(0, 19).replace('T', ' ')}
                      </p>
                      {v.created_by && (
                        <p className="text-[10px] text-gray-400">boi {v.created_by}</p>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-slate-400">
                      {v.content.slice(0, 160)}
                      {v.content.length > 160 ? '...' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRollback(v.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300"
                  >
                    <Undo2 size={12} />
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPrompts;
