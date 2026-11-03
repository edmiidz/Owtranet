import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MessageSquare,
  Plus,
  Tag,
  TrendingUp,
  Clock,
  Eye,
  MessageCircle,
  ThumbsUp,
  Pin,
  Lock
} from 'lucide-react';
import { postsApi } from '../utils/api';
import type { Post } from '../types';

interface Tag {
  id: number;
  name: string;
  slug: string;
  usage_count: number;
}

const ForumPage: React.FC = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [sortBy, setSortBy] = useState('recent');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTag = searchParams.get('tag');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });

  const sortOptions = [
    { value: 'recent', label: 'Most Recent', icon: Clock },
    { value: 'popular', label: 'Most Popular', icon: TrendingUp },
    { value: 'views', label: 'Most Viewed', icon: Eye },
    { value: 'unanswered', label: 'Unanswered', icon: MessageCircle },
  ];

  useEffect(() => {
    loadPosts();
    loadPopularTags();
  }, [currentPage, sortBy, selectedTag]);

  const loadPosts = async () => {
    try {
      setIsLoading(true);
      const response = await postsApi.getPosts({
        page: currentPage,
        limit: 20,
        sort: sortBy,
        tag: selectedTag || undefined
      });

      setPosts(response.posts || []);
      setPagination(response.pagination);
    } catch (error) {
      console.error('Failed to load posts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPopularTags = async () => {
    try {
      const token = localStorage.getItem('owtranet-token');
      if (!token) {
        console.warn('No auth token found for loading tags');
        return;
      }

      const response = await fetch('/api/tags/popular', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('Tags API failed with status:', response.status);
        const errorData = await response.json();
        console.error('Error response:', errorData);
        return;
      }

      const data = await response.json();
      console.log('Successfully loaded tags:', data.tags?.length || 0);
      setPopularTags(data.tags || []);
    } catch (error) {
      console.error('Failed to load popular tags:', error);
    }
  };

  const handleTagClick = (tagSlug: string) => {
    if (selectedTag === tagSlug) {
      searchParams.delete('tag');
    } else {
      searchParams.set('tag', tagSlug);
    }
    setSearchParams(searchParams);
    setCurrentPage(1);
  };

  const ProfilePicture: React.FC<{ post: Post }> = ({ post }) => {
    if (post.avatar_url) {
      return (
        <img
          src={post.avatar_url}
          alt={`${post.author_name} profile`}
          className="h-10 w-10 rounded-full object-cover"
        />
      );
    }

    return (
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
        <span className="text-sm font-medium text-white">
          {post.author_name?.charAt(0)?.toUpperCase()}
        </span>
      </div>
    );
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Discussion Forum</h1>
          <p className="mt-2 text-gray-600">
            Share knowledge, ask questions, and collaborate with the team
          </p>
        </div>
        <Link 
          to="/forum/create" 
          className="btn btn-primary mt-4 sm:mt-0 inline-flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Post
        </Link>
      </div>

      {/* Filters and Tags */}
      <div className="card p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Sort Options */}
          <div className="flex flex-wrap gap-2">
            {sortOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    setSortBy(option.value);
                    setCurrentPage(1);
                  }}
                  className={`
                    flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors
                    ${sortBy === option.value
                      ? 'bg-primary-100 text-primary-700 border border-primary-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Popular Tags */}
          <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
            <span className="text-sm text-gray-600 font-medium flex items-center">
              <Tag className="h-4 w-4 mr-1" />
              Popular tags:
            </span>
            {popularTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => handleTagClick(tag.slug)}
                className={`
                  px-3 py-1 rounded-full text-sm font-medium transition-colors
                  ${selectedTag === tag.slug
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                {tag.name}
                <span className="ml-1 opacity-60">({tag.usage_count})</span>
              </button>
            ))}
            {selectedTag && (
              <button
                onClick={() => handleTagClick('')}
                className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Posts List */}
      <div className="space-y-4">
        {isLoading ? (
          // Loading skeleton
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="card p-6 animate-pulse">
                <div className="flex items-start space-x-4">
                  <div className="h-10 w-10 bg-gray-300 rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-300 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <div key={post.id} className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start space-x-4">
                {/* Author Avatar */}
                <Link to={`/profile/${post.intranet_username || `id:${post.user_id}`}`}>
                  <ProfilePicture post={post} />
                </Link>

                {/* Post Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Post Title */}
                      <div className="flex items-center space-x-2 mb-2">
                        {Boolean(post.is_pinned) && (
                          <Pin className="h-4 w-4 text-yellow-500" />
                        )}
                        {Boolean(post.is_locked) && (
                          <Lock className="h-4 w-4 text-gray-500" />
                        )}
                        <Link
                          to={`/forum/post/${post.slug}`}
                          className="text-lg font-semibold text-gray-900 hover:text-primary-600"
                        >
                          {post.title}
                        </Link>
                      </div>

                      {/* Post Preview */}
                      <p className="text-gray-600 mb-3 line-clamp-2">
                        {post.content.substring(0, 200)}
                        {post.content.length > 200 && '...'}
                      </p>

                      {/* Post Meta */}
                      <div className="flex items-center text-sm text-gray-500 space-x-4">
                        <Link 
                          to={`/profile/${post.intranet_username || `id:${post.user_id}`}`}
                          className="hover:text-primary-600"
                        >
                          {post.author_name}
                        </Link>
                        <span>•</span>
                        <span>{formatTimeAgo(post.created_at)}</span>
                        <span>•</span>
                        <div className="flex items-center">
                          <Eye className="h-3 w-3 mr-1" />
                          {post.view_count} views
                        </div>
                        <span>•</span>
                        <div className="flex items-center">
                          <MessageCircle className="h-3 w-3 mr-1" />
                          {post.comment_count || 0} replies
                        </div>
                        {post.score !== undefined && (
                          <>
                            <span>•</span>
                            <div className="flex items-center">
                              <ThumbsUp className="h-3 w-3 mr-1" />
                              {post.score} likes
                            </div>
                          </>
                        )}
                      </div>

                      {/* Tags */}
                      {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {post.tags.map((tag) => (
                            <Link
                              key={tag.id}
                              to={`/forum?tag=${tag.slug}`}
                              className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs hover:bg-gray-200"
                            >
                              {tag.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          // Empty state
          <div className="card p-12 text-center">
            <MessageSquare className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No posts found</h3>
            <p className="text-gray-600 mb-6">
              {selectedTag
                ? `No posts with tag "${selectedTag}". Try a different tag or clear the filter.`
                : 'Be the first to start a discussion!'
              }
            </p>
            <Link to="/forum/create" className="btn btn-primary inline-flex items-center">
              <Plus className="h-4 w-4 mr-2" />
              Create First Post
            </Link>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center space-x-2">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          
          <div className="flex items-center space-x-1">
            {[...Array(Math.min(5, pagination.pages))].map((_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`
                    px-3 py-2 rounded-lg text-sm font-medium transition-colors
                    ${currentPage === pageNum
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setCurrentPage(Math.min(pagination.pages, currentPage + 1))}
            disabled={currentPage === pagination.pages}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Forum Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary-600">{pagination.total}</div>
            <div className="text-sm text-gray-600">Total Posts</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {posts.filter(p => (p.comment_count || 0) === 0).length}
            </div>
            <div className="text-sm text-gray-600">Unanswered</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {posts.reduce((sum, p) => sum + (p.view_count || 0), 0)}
            </div>
            <div className="text-sm text-gray-600">Total Views</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {posts.reduce((sum, p) => sum + (p.comment_count || 0), 0)}
            </div>
            <div className="text-sm text-gray-600">Total Replies</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForumPage;
