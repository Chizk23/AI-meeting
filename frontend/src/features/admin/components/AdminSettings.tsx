import React from 'react';
import { Save } from 'lucide-react';
import api from '../../../services/api';
import { toast } from '../../../components/ui/Toast';

type SystemSettings = {
  public_registration_enabled: boolean;
  storage_limit_gb_per_org: number;
  transcript_retention_policy: string;
  maintenance_mode: boolean;
};

const AdminSettings: React.FC = () => {
  const [settings, setSettings] = React.useState<SystemSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/admin/settings');
      setSettings(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Khong tai duoc system settings');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const updateField = (key: keyof SystemSettings, value: string | number | boolean) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await api.patch('/api/admin/settings', settings);
      setSettings(response.data);
      toast.success('Da cap nhat system settings');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Khong cap nhat duoc settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Dang tai cau hinh he thong...</p>;
  if (!settings) return <p className="text-sm text-red-500">{error || 'Khong co du lieu settings'}</p>;

  return (
    <div className="mx-auto max-w-4xl rounded-3xl border border-gray-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-6 text-2xl font-black text-gray-900 dark:text-slate-100">Cau hinh he thong</h3>
      {error && <p className="mb-4 text-sm font-semibold text-red-500">{error}</p>}

      <div className="space-y-6">
        <label className="flex items-center justify-between gap-3 text-sm font-semibold text-gray-800 dark:text-slate-200">
          Cho phep dang ky cong khai
          <input
            type="checkbox"
            checked={settings.public_registration_enabled}
            onChange={(e) => updateField('public_registration_enabled', e.target.checked)}
          />
        </label>

        <label className="block text-sm font-semibold text-gray-800 dark:text-slate-200">
          Dung luong toi da moi to chuc (GB)
          <input
            type="number"
            value={settings.storage_limit_gb_per_org}
            onChange={(e) => updateField('storage_limit_gb_per_org', Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>

        <label className="block text-sm font-semibold text-gray-800 dark:text-slate-200">
          Chinh sach luu transcript
          <select
            value={settings.transcript_retention_policy}
            onChange={(e) => updateField('transcript_retention_policy', e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="forever">Vinh vien</option>
            <option value="1-year">1 nam</option>
            <option value="6-months">6 thang</option>
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 text-sm font-semibold text-red-700 dark:text-red-400">
          Maintenance mode
          <input
            type="checkbox"
            checked={settings.maintenance_mode}
            onChange={(e) => updateField('maintenance_mode', e.target.checked)}
          />
        </label>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-black text-white hover:bg-black disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          <Save size={16} />
          {saving ? 'Dang luu...' : 'Luu tat ca'}
        </button>
      </div>
    </div>
  );
};

export default AdminSettings;
