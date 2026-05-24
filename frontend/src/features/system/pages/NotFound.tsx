/**
 * NotFound - 404 Page
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileQuestion, ArrowLeft, Home } from 'lucide-react';

const NotFound: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md text-center"
      >
        {/* 404 Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
          <FileQuestion size={40} className="text-primary-600 dark:text-primary-300" />
        </div>

        {/* Error Code */}
        <h1 className="text-8xl font-bold text-gray-900 dark:text-slate-100">
          404
        </h1>

        {/* Error Message */}
        <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-slate-100">
          Không tìm thấy trang
        </h2>
        <p className="mt-2 text-gray-600 dark:text-slate-400">
          Trang bạn tìm không tồn tại doesn't exist or has been moved.
        </p>

        {/* URL Display */}
        <div className="mt-4 rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm text-gray-600 dark:bg-slate-900 dark:text-slate-400">
          {location.pathname}
        </div>

        {/* Actions */}
        <div className="mt-8 flex justify-center gap-3">
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
        </div>

        {/* Help Text */}
        <p className="mt-8 text-xs text-gray-500 dark:text-slate-500">
          If you believe this is an error, please contact your system administrator.
        </p>
      </motion.div>
    </div>
  );
};

export default NotFound;
