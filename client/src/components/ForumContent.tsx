import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageModal from './ImageModal';
import MermaidRenderer from './MermaidRenderer';
import api from '../utils/api';

interface ForumContentProps {
  content: string;
  className?: string;
}

interface ContentPart {
  type: 'html' | 'mermaid';
  content: string;
}

interface WikiLinkInfo {
  exists: boolean;
  slug?: string;
  title?: string;
}

interface WikiLinksCache {
  [title: string]: WikiLinkInfo;
}

const ForumContent: React.FC<ForumContentProps> = ({ content, className = '' }) => {
  const [showImageModal, setShowImageModal] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [modalImageAlt, setModalImageAlt] = useState('');
  const [wikiLinksCache, setWikiLinksCache] = useState<WikiLinksCache>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Parse content to extract mermaid blocks
  const contentParts = useMemo((): ContentPart[] => {
    if (!content) return [];

    const parts: ContentPart[] = [];

    // Match <pre><code class="language-mermaid">...</code></pre> blocks
    // The marked library outputs code blocks with language-* class
    const mermaidRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi;

    let lastIndex = 0;
    let match;

    while ((match = mermaidRegex.exec(content)) !== null) {
      // Add HTML content before this mermaid block
      if (match.index > lastIndex) {
        const htmlPart = content.slice(lastIndex, match.index);
        if (htmlPart.trim()) {
          parts.push({ type: 'html', content: htmlPart });
        }
      }

      // Decode HTML entities in the mermaid code
      const mermaidCode = match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

      parts.push({ type: 'mermaid', content: mermaidCode });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining HTML content after the last mermaid block
    if (lastIndex < content.length) {
      const htmlPart = content.slice(lastIndex);
      if (htmlPart.trim()) {
        parts.push({ type: 'html', content: htmlPart });
      }
    }

    // If no mermaid blocks found, return the entire content as HTML
    if (parts.length === 0 && content.trim()) {
      parts.push({ type: 'html', content });
    }

    return parts;
  }, [content]);

  // Extract wiki link titles from content
  const wikiLinkTitles = useMemo(() => {
    if (!content) return [];

    const titles: string[] = [];
    const wikiLinkRegex = /<a[^>]*class="wiki-link"[^>]*data-wiki-title="([^"]+)"[^>]*>/gi;
    let match;

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const title = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      if (!titles.includes(title)) {
        titles.push(title);
      }
    }

    return titles;
  }, [content]);

  // Fetch wiki link info when titles change
  useEffect(() => {
    if (wikiLinkTitles.length === 0) return;

    // Filter out titles we already have cached
    const uncachedTitles = wikiLinkTitles.filter(t => !(t in wikiLinksCache));
    if (uncachedTitles.length === 0) return;

    const fetchWikiLinks = async () => {
      try {
        const response = await api.post('/wiki-links/lookup', { titles: uncachedTitles });
        if (response.data.links) {
          setWikiLinksCache(prev => ({ ...prev, ...response.data.links }));
        }
      } catch (error) {
        console.error('Failed to fetch wiki links:', error);
      }
    };

    fetchWikiLinks();
  }, [wikiLinkTitles]);

  // Handle wiki link clicks
  useEffect(() => {
    if (!contentRef.current) return;

    const wikiLinks = contentRef.current.querySelectorAll('a.wiki-link');
    const clickHandlers: Array<() => void> = [];

    wikiLinks.forEach((link) => {
      const handleClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();

        const title = (link as HTMLElement).dataset.wikiTitle;
        if (!title) return;

        const linkInfo = wikiLinksCache[title];

        if (linkInfo?.exists && linkInfo.slug) {
          // Navigate to existing post
          navigate(`/forum/post/${linkInfo.slug}`);
        } else {
          // Navigate to create new post with title pre-filled
          navigate('/forum/create', { state: { prefillTitle: title } });
        }
      };

      link.addEventListener('click', handleClick);
      clickHandlers.push(() => link.removeEventListener('click', handleClick));

      // Update link styling based on existence
      const title = (link as HTMLElement).dataset.wikiTitle;
      if (title && title in wikiLinksCache) {
        const linkInfo = wikiLinksCache[title];
        if (linkInfo.exists) {
          link.classList.remove('wiki-link-missing');
          link.classList.add('wiki-link-exists');
        } else {
          link.classList.remove('wiki-link-exists');
          link.classList.add('wiki-link-missing');
        }
      }
    });

    return () => {
      clickHandlers.forEach(cleanup => cleanup());
    };
  }, [content, wikiLinksCache, navigate]);

  // Handle anchor link clicks for smooth scrolling to headings
  useEffect(() => {
    if (!contentRef.current) return;

    const anchorLinks = contentRef.current.querySelectorAll('a.anchor-link, a[href^="#"]');
    const clickHandlers: Array<() => void> = [];

    anchorLinks.forEach((link) => {
      const handleClick = (e: Event) => {
        const href = (link as HTMLAnchorElement).getAttribute('href');
        if (!href || !href.startsWith('#')) return;

        e.preventDefault();
        const targetId = href.slice(1); // Remove the #
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Update URL hash without jumping
          window.history.pushState(null, '', href);
        }
      };

      link.addEventListener('click', handleClick);
      clickHandlers.push(() => link.removeEventListener('click', handleClick));
    });

    return () => {
      clickHandlers.forEach(cleanup => cleanup());
    };
  }, [content]);

  // Handle image clicks for modal
  useEffect(() => {
    if (!contentRef.current) return;

    const images = contentRef.current.querySelectorAll('img');
    const clickHandlers: Array<() => void> = [];

    images.forEach((img) => {
      const handleImageClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();

        const imgElement = e.target as HTMLImageElement;
        setModalImageUrl(imgElement.src);
        setModalImageAlt(imgElement.alt || 'Forum image');
        setShowImageModal(true);
      };

      img.addEventListener('click', handleImageClick);
      clickHandlers.push(() => img.removeEventListener('click', handleImageClick));
    });

    return () => {
      clickHandlers.forEach(cleanup => cleanup());
    };
  }, [content]);

  return (
    <>
      <style>{`
        .wiki-link {
          cursor: pointer;
          text-decoration: none;
          border-bottom: 1px dashed currentColor;
        }
        .wiki-link-exists {
          color: #2563eb;
          border-bottom-color: #2563eb;
        }
        .wiki-link-exists:hover {
          color: #1d4ed8;
          border-bottom-style: solid;
        }
        .wiki-link-missing {
          color: #dc2626;
          border-bottom-color: #dc2626;
        }
        .wiki-link-missing:hover {
          color: #b91c1c;
          border-bottom-style: solid;
        }
        .wiki-link:not(.wiki-link-exists):not(.wiki-link-missing) {
          color: #6b7280;
          border-bottom-color: #6b7280;
        }
        .anchor-link {
          color: #2563eb;
          text-decoration: none;
        }
        .anchor-link:hover {
          text-decoration: underline;
        }
        /* Add scroll margin to headings so they're not hidden under fixed headers */
        h1[id], h2[id], h3[id], h4[id], h5[id], h6[id] {
          scroll-margin-top: 80px;
        }
      `}</style>

      <div ref={contentRef} className={`prose prose-sm max-w-none ${className}`}>
        {contentParts.map((part, index) => {
          if (part.type === 'mermaid') {
            return (
              <MermaidRenderer
                key={`mermaid-${index}`}
                chart={part.content}
                className="my-4"
              />
            );
          }

          return (
            <div
              key={`html-${index}`}
              dangerouslySetInnerHTML={{ __html: part.content }}
            />
          );
        })}
      </div>

      <ImageModal
        isOpen={showImageModal}
        imageUrl={modalImageUrl}
        altText={modalImageAlt}
        onClose={() => setShowImageModal(false)}
      />
    </>
  );
};

export default ForumContent;
