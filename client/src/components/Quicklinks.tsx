import React, { useEffect, useState } from 'react';
import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { quicklinksApi } from '../utils/api';
import type { Quicklink } from '../types';

const Quicklinks: React.FC = () => {
  const [quicklinks, setQuicklinks] = useState<Quicklink[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadQuicklinks = async () => {
      try {
        const data = await quicklinksApi.getQuicklinks();
        setQuicklinks(data);
      } catch (error) {
        console.error('Failed to load quicklinks:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadQuicklinks();
  }, []);

  if (isLoading) {
    return (
      <div className="card p-4">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Links</h3>
        <div className="animate-pulse">
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (quicklinks.length === 0) {
    return null;
  }

  return (
    <div className="card p-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
        <LinkIcon className="h-5 w-5 mr-2" />
        Quick Links
      </h3>
      <div className="space-y-2">
        {quicklinks.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group"
          >
            <div className="flex-1">
              <div className="font-medium text-gray-900 group-hover:text-blue-600">
                {link.title}
              </div>
              {link.description && (
                <div className="text-sm text-gray-500 mt-1">
                  {link.description}
                </div>
              )}
            </div>
            <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600" />
          </a>
        ))}
      </div>
    </div>
  );
};

export default Quicklinks;