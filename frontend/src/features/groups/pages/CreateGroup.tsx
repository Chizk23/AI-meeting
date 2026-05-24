/**
 * CreateGroup Page
 * Page để tạo group mới (wrapper cho CreateGroupModal)
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CreateGroupModal from '../components/CreateGroupModal';

const CreateGroup: React.FC = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);

  const handleClose = () => {
    setIsOpen(false);
    navigate(-1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <ArrowLeft size={14} />
          Back
        </button>
      </div>

      {/* Create Group Modal */}
      <CreateGroupModal isOpen={isOpen} onClose={handleClose} />
    </div>
  );
};

export default CreateGroup;
