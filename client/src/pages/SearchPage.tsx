import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, User, FileText, MessageSquare, Filter, DollarSign, CheckSquare, Receipt, BookOpen, ExternalLink, Bot } from 'lucide-react';
import { searchApi } from '../utils/api';
import type { SearchResults, Post, User as UserType, Investment, Task, LedgerSearchResult, GithubDoc } from '../types';

type SearchType = 'all' | 'posts' | 'users' | 'agents' | 'comments' | 'investments' | 'tasks' | 'ledger' | 'docs';
const SEARCH_TYPES: SearchType[] = ['all', 'posts', 'users', 'agents', 'comments', 'investments', 'tasks', 'ledger', 'docs'];

// Where each indexed doc actually lives, for the provenance line on a result.
// 'exec' rows only reach a client at all when the viewer is an admin — the
// server filters them out of the query otherwise.
const DOC_COLLECTION_LABELS: Record<GithubDoc['collection'], string> = {
  help: 'Help Center',
  guide: 'Integration Guide',
  internal: 'Engineering Doc',
  exec: 'Executive & Legal',
};

const DOC_COLLECTION_STYLES: Record<GithubDoc['collection'], string> = {
  help: 'bg-green-100 text-green-800',
  guide: 'bg-blue-100 text-blue-800',
  internal: 'bg-purple-100 text-purple-800',
  exec: 'bg-amber-100 text-amber-800',
};

const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params
  const initialQuery = searchParams.get('q') || '';
  const initialType = (searchParams.get('type') || 'all') as SearchType;
  const initialUserStatus = (searchParams.get('status') || 'all') as 'all' | 'active' | 'inactive' | 'pending';

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResults>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchType, setSearchType] = useState<SearchType>(
    SEARCH_TYPES.includes(initialType) ? initialType : 'all'
  );
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>(initialUserStatus);
  const [error, setError] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);

  // Search function (handles both query and no-query cases)
  const performSearch = useCallback(async (searchQuery: string, type: string = 'all') => {
    setIsLoading(true);
    setError('');

    try {
      // Always call the API - it now handles empty queries by returning all results
      const searchResults = await searchApi.search(searchQuery.trim() || '', type);
      setResults(searchResults);
    } catch (err: any) {
      setError('Failed to perform search');
      console.error('Search error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial search on component mount
  useEffect(() => {
    performSearch(query, searchType);
    setIsInitialized(true);
  }, []); // Only run once on mount

  // Update URL and perform search when query or type changes (after initialization)
  useEffect(() => {
    if (!isInitialized) return; // Skip on initial mount

    const timeoutId = setTimeout(() => {
      // Update URL parameters
      const newParams = new URLSearchParams();

      if (query) {
        newParams.set('q', query);
      }

      if (searchType && searchType !== 'all') {
        newParams.set('type', searchType);
      }

      if (userStatusFilter && userStatusFilter !== 'all') {
        newParams.set('status', userStatusFilter);
      }

      // Update URL without triggering navigation
      setSearchParams(newParams, { replace: true });

      // Perform the search
      performSearch(query, searchType);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [query, searchType, userStatusFilter, performSearch, setSearchParams, isInitialized]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleTypeChange = (type: SearchType) => {
    setSearchType(type);
  };

  const getTotalResults = () => {
    const postCount = results.posts?.length || 0;
    const userCount = results.users?.length || 0;
    const commentCount = results.comments?.length || 0;
    const investmentCount = results.investments?.length || 0;
    const taskCount = results.tasks?.length || 0;
    const ledgerCount = results.ledger?.length || 0;
    const docCount = results.docs?.length || 0;
    const agentCount = results.agents?.length || 0;
    return postCount + userCount + commentCount + investmentCount + taskCount + ledgerCount + docCount + agentCount;
  };

  const getFilteredUsers = () => {
    if (!results.users) return [];
    if (userStatusFilter === 'all') return results.users;
    return results.users.filter(user => user.activity_status === userStatusFilter);
  };

  const getUserCountByStatus = (status: 'active' | 'inactive' | 'pending') => {
    if (!results.users) return 0;
    return results.users.filter(user => user.activity_status === status).length;
  };

  const getStatusBadgeColor = (status?: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  // Short excerpt of a user's bio centred on the query, shown when the bio
  // (rather than the name) is what matched.
  const getBioSnippet = (bio?: string) => {
    if (!bio || !query.trim()) return null;
    const idx = bio.toLowerCase().indexOf(query.trim().toLowerCase());
    if (idx === -1) return null;
    const start = Math.max(0, idx - 60);
    const end = Math.min(bio.length, idx + query.length + 80);
    return `${start > 0 ? '…' : ''}${bio.slice(start, end)}${end < bio.length ? '…' : ''}`;
  };

  const formatMoney = (value: number | null | undefined, currency?: string) => {
    if (value === null || value === undefined) return null;
    return `${Number(value).toFixed(2)}${currency ? ` ${currency}` : ''}`;
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getLedgerStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
      case 'reimbursed':
      case 'paid': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'inactive':
        return 'Inactive';
      case 'pending':
        return 'Pending';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Search</h1>
        <p className="text-gray-600">Search across profiles (including bios), forum posts, comments, investments, tasks, ledger entries, and documentation</p>
      </div>

      {/* Search Input */}
      <div className="card p-6">
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search posts, people, comments, tasks, ledger entries, docs..."
            className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleTypeChange('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'all' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Filter className="h-4 w-4 inline mr-1" />
            All Results
          </button>
          <button
            onClick={() => handleTypeChange('posts')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'posts' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <FileText className="h-4 w-4 inline mr-1" />
            Posts ({results.posts?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('users')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'users' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <User className="h-4 w-4 inline mr-1" />
            Users ({results.users?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('agents')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'agents'
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Bot className="h-4 w-4 inline mr-1" />
            AI Agents ({results.agents?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('comments')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'comments' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <MessageSquare className="h-4 w-4 inline mr-1" />
            Comments ({results.comments?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('investments')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'investments'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <DollarSign className="h-4 w-4 inline mr-1" />
            Investments ({results.investments?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('tasks')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'tasks'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <CheckSquare className="h-4 w-4 inline mr-1" />
            Tasks ({results.tasks?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('ledger')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'ledger'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Receipt className="h-4 w-4 inline mr-1" />
            Ledger ({results.ledger?.length || 0})
          </button>
          <button
            onClick={() => handleTypeChange('docs')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              searchType === 'docs'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <BookOpen className="h-4 w-4 inline mr-1" />
            Docs ({results.docs?.length || 0})
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Searching...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-6 border-red-200 bg-red-50">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Results Summary */}
      {query && !isLoading && getTotalResults() > 0 && (
        <div className="card p-4 bg-blue-50 border-blue-200">
          <p className="text-blue-700 font-medium">
            Found {getTotalResults()} result{getTotalResults() !== 1 ? 's' : ''} for "{query}"
          </p>
        </div>
      )}

      {/* No Results */}
      {query && !isLoading && getTotalResults() === 0 && (
        <div className="card p-8 text-center">
          <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No results found for "{query}"</p>
          <p className="text-gray-500 text-sm mt-2">Try different keywords or search terms</p>
        </div>
      )}

      {/* Search Results */}
      {!isLoading && (
        <div className="space-y-6">
          {/* Posts Results */}
          {results.posts && results.posts.length > 0 && (searchType === 'all' || searchType === 'posts') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                Posts ({results.posts.length})
              </h2>
              <div className="space-y-4">
                {results.posts.map((post: Post) => (
                  <div key={post.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 mb-2">
                          <a href={`/forum/post/${post.slug}`} className="hover:text-blue-600 transition-colors">
                            {post.title}
                          </a>
                        </h3>
                        <p className="text-gray-600 text-sm mb-2">
                          {post.content?.substring(0, 200)}...
                        </p>
                        <div className="flex items-center text-xs text-gray-500">
                          <span>by {post.author_name}</span>
                          <span className="mx-2">•</span>
                          <span>{new Date(post.created_at).toLocaleDateString()}</span>
                          <span className="mx-2">•</span>
                          <span>{post.view_count || 0} views</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users Results */}
          {results.users && results.users.length > 0 && (searchType === 'all' || searchType === 'users') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Users ({results.users.length})
              </h2>

              {/* Status Filter Buttons - Only show when viewing users */}
              {searchType === 'users' && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => setUserStatusFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      userStatusFilter === 'all'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    All ({results.users.length})
                  </button>
                  <button
                    onClick={() => setUserStatusFilter('active')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      userStatusFilter === 'active'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Active ({getUserCountByStatus('active')})
                  </button>
                  <button
                    onClick={() => setUserStatusFilter('inactive')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      userStatusFilter === 'inactive'
                        ? 'bg-gray-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Inactive ({getUserCountByStatus('inactive')})
                  </button>
                  <button
                    onClick={() => setUserStatusFilter('pending')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      userStatusFilter === 'pending'
                        ? 'bg-yellow-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Pending ({getUserCountByStatus('pending')})
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getFilteredUsers().map((user: UserType) => (
                  <div key={user.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start space-x-3">
                      <img
                        src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`}
                        alt={user.name}
                        className="w-12 h-12 rounded-full flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-900 truncate">
                            <a href={`/profile/${user.intranet_username || `id:${user.id}`}`} className="hover:text-blue-600 transition-colors">
                              {user.name}
                            </a>
                          </h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getStatusBadgeColor(user.activity_status)}`}>
                            {getStatusLabel(user.activity_status)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">@{user.intranet_username || `id:${user.id}`}</p>
                        {(user.department || user.position) && (
                          <p className="text-xs text-gray-400 truncate">
                            {user.position}{user.department ? ` • ${user.department}` : ''}
                          </p>
                        )}
                        {getBioSnippet(user.bio) && (
                          <p className="text-xs text-gray-600 mt-1 italic">
                            {getBioSnippet(user.bio)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Agents Results */}
          {results.agents && results.agents.length > 0 && (searchType === 'all' || searchType === 'agents') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-1 flex items-center">
                <Bot className="h-5 w-5 mr-2 text-violet-600" />
                AI Agents ({results.agents.length})
              </h2>
              <p className="text-sm text-gray-500 mb-4">Tag an agent with @ in a forum post or comment to bring it into the thread.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.agents.map((agent) => (
                  <a
                    key={agent.id}
                    href={`/profile/${agent.handle}`}
                    className="border border-violet-200 bg-violet-50/40 rounded-lg p-4 hover:bg-violet-50 transition-colors block"
                  >
                    <div className="flex items-start space-x-3">
                      <img
                        src={agent.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(agent.name)}&background=7c3aed&color=fff`}
                        alt={agent.name}
                        className="w-12 h-12 rounded-full flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-900 truncate">{agent.name}</h3>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                            <Bot className="h-3 w-3" /> AI
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">@{agent.handle}</p>
                        {agent.tagline && <p className="text-xs text-gray-600 mt-1">{agent.tagline}</p>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Comments Results */}
          {results.comments && results.comments.length > 0 && (searchType === 'all' || searchType === 'comments') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <MessageSquare className="h-5 w-5 mr-2" />
                Comments ({results.comments.length})
              </h2>
              <div className="space-y-4">
                {results.comments.map((comment: any) => (
                  <div key={comment.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2">
                          <a href={`/forum/post/${comment.post_slug}`} className="text-sm text-blue-600 hover:underline">
                            {comment.post_title}
                          </a>
                        </div>
                        <p className="text-gray-600 text-sm mb-2">
                          {comment.content?.substring(0, 300)}...
                        </p>
                        <div className="flex items-center text-xs text-gray-500">
                          <span>by {comment.author_name}</span>
                          <span className="mx-2">•</span>
                          <span>{new Date(comment.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Investments Results */}
          {results.investments && results.investments.length > 0 && (searchType === 'all' || searchType === 'investments') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <DollarSign className="h-5 w-5 mr-2" />
                Investments ({results.investments.length})
              </h2>
              <div className="space-y-4">
                {results.investments.map((investment: Investment) => (
                  <div key={investment.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 mb-2">
                          <a href={`/investment-tracker/${investment.id}`} className="hover:text-blue-600 transition-colors">
                            {investment.title}
                          </a>
                        </h3>
                        <p className="text-gray-600 text-sm mb-2">
                          {investment.content?.substring(0, 200)}...
                        </p>
                        <div className="flex items-center text-xs text-gray-500 gap-4">
                          <span className="flex items-center">
                            <User className="h-3 w-3 mr-1" />
                            {investment.nominee_name || investment.user_name}
                          </span>
                          {investment.theoretical_value_usd && (
                            <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full font-medium">
                              ${Number(investment.theoretical_value_usd).toFixed(2)}
                            </span>
                          )}
                          {investment.investment_category && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full capitalize">
                              {investment.investment_category.replace('_', ' ')}
                            </span>
                          )}
                          <span>{new Date(investment.deliverable_date).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks Results */}
          {results.tasks && results.tasks.length > 0 && (searchType === 'all' || searchType === 'tasks') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <CheckSquare className="h-5 w-5 mr-2" />
                Tasks ({results.tasks.length})
              </h2>
              <div className="space-y-4">
                {results.tasks.map((task: Task) => (
                  <div key={task.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <h3 className="font-medium text-gray-900 mb-2">
                      <a href={`/tasks/${task.id}`} className="hover:text-blue-600 transition-colors">
                        {task.title}
                      </a>
                    </h3>
                    {task.description && (
                      <p className="text-gray-600 text-sm mb-2">
                        {task.description.substring(0, 200)}{task.description.length > 200 ? '...' : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center text-xs text-gray-500 gap-x-4 gap-y-1">
                      <span className={`px-2 py-0.5 rounded-full font-medium capitalize ${getTaskStatusColor(task.status)}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                      <span className="capitalize">{task.priority} priority</span>
                      {task.assignee_name && <span>assigned to {task.assignee_name}</span>}
                      {task.creator_name && <span>by {task.creator_name}</span>}
                      {task.due_date && <span>due {new Date(task.due_date).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ledger Results */}
          {results.ledger && results.ledger.length > 0 && (searchType === 'all' || searchType === 'ledger') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Receipt className="h-5 w-5 mr-2" />
                Ledger ({results.ledger.length})
              </h2>
              <div className="space-y-4">
                {results.ledger.map((entry: LedgerSearchResult) => (
                  <div key={entry.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <h3 className="font-medium text-gray-900 mb-2">
                      <a href={`/ledger/${entry.id}`} className="hover:text-blue-600 transition-colors">
                        {entry.title}
                      </a>
                    </h3>
                    {entry.description && (
                      <p className="text-gray-600 text-sm mb-2">
                        {entry.description.substring(0, 200)}{entry.description.length > 200 ? '...' : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center text-xs text-gray-500 gap-x-4 gap-y-1">
                      <span className={`px-2 py-0.5 rounded-full font-medium capitalize ${getLedgerStatusColor(entry.status)}`}>
                        {entry.is_draft ? 'draft' : entry.status.replace('_', ' ')}
                      </span>
                      {formatMoney(entry.total_with_tax ?? entry.amount, entry.original_currency) && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full font-medium">
                          {formatMoney(entry.total_with_tax ?? entry.amount, entry.original_currency)}
                        </span>
                      )}
                      {entry.vendor_name && <span>{entry.vendor_name}</span>}
                      {entry.expense_category && <span className="capitalize">{entry.expense_category.replace(/_/g, ' ')}</span>}
                      {entry.project_code && <span>{entry.project_code}</span>}
                      <span>{entry.payee_name || entry.user_name}</span>
                      <span>{new Date(entry.expense_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Docs Results — stubs for documents that live in GitHub / the help
              site. The title opens an intranet container page; "Access now"
              jumps straight to the real document for people who don't need the
              interstitial. */}
          {results.docs && results.docs.length > 0 && (searchType === 'all' || searchType === 'docs') && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <BookOpen className="h-5 w-5 mr-2" />
                Docs ({results.docs.length})
              </h2>
              <div className="space-y-4">
                {results.docs.map((doc: GithubDoc) => (
                  <div key={doc.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 mb-2">
                          <a href={`/docs/${doc.id}`} className="hover:text-blue-600 transition-colors">
                            {doc.title}
                          </a>
                        </h3>
                        {doc.summary && (
                          <p className="text-gray-600 text-sm mb-2">
                            {doc.summary.substring(0, 200)}{doc.summary.length > 200 ? '…' : ''}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center text-xs text-gray-500 gap-x-4 gap-y-1">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${DOC_COLLECTION_STYLES[doc.collection]}`}>
                            {DOC_COLLECTION_LABELS[doc.collection]}
                          </span>
                          <span className="truncate max-w-xs" title={`${doc.repo}/${doc.path}`}>{doc.path}</span>
                          {doc.word_count ? <span>{doc.word_count.toLocaleString()} words</span> : null}
                        </div>
                      </div>
                      <a
                        href={doc.access_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 inline-flex items-center px-3 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        Access now
                        <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search Tips */}
      {!query && !isLoading && getTotalResults() > 0 && (
        <div className="card p-6 bg-blue-50 border-blue-200">
          <div className="flex items-center mb-2">
            <Search className="h-5 w-5 text-blue-600 mr-2" />
            <h3 className="font-medium text-blue-900">Search Tips</h3>
          </div>
          <div className="text-sm text-blue-700">
            <p>• Type in the search box to filter results</p>
            <p>• Use the filter tabs to narrow by content type</p>
            <p>• Click on any result to navigate to it</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchPage;