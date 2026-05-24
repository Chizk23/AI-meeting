/**
 * Forbidden - 403 Page
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldX, ArrowLeft, Home, Mail } from 'lucide-react';

const Forbidden: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md text-center"
      >
        {/* Lock Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <ShieldX size={40} className="text-red-600 dark:text-red-400" />
        </div>

        {/* Error Code */}
        <h1 className="text-8xl font-bold text-gray-900 dark:text-slate-100">
          403
        </h1>

        {/* Error Message */}
        <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-slate-100">
          Truy cập bị từ chối
        </h2>
        <p className="mt-2 text-gray-600 dark:text-slate-400">
          You don't have permission to view this page. Contact your organization admin for access.
        </p>

        {/* URL Display */}
        <div className="mt-4 rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm text-gray-600 dark:bg-slate-900 dark:text-slate-400">
          {location.pathname}
        </div>

        {/* Role Info */}
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-medium">Possible reasons:</p>
          <ul className="mt-2 space-y-1 text-left text-xs">
            <li>• Your account doesn't have the required permissions</li>
            <li>• You're trying to access a different organization</li>
            <li>• The resource has been restricted by your admin</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
          >
            <Home size={16} />
            Về bảng điều khiển
          </Link>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <ArrowLeft size={16} />
            Quay lại
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
            <Mail size={16} />
            Yêu cầu quyền
          </button>
        </div>

        {/* Help Text */}
        <p className="mt-8 text-xs text-gray-500 dark:text-slate-500">
          If you need access, please contact your organization administrator or IT support team.
        </p>
      </motion.div>
    </div>
  );
};

export default Forbidden;
