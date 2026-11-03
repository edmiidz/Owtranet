import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MessageSquare, Clock, Eye, MessageCircle, Sparkles, ArrowRight, FileSignature } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { postsApi, agreementsApi } from '../utils/api';
import type { Post, AgreementAssignment } from '../types';
import Quicklinks from '../components/Quicklinks';

const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const { companyName } = useBrandingStore();
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAgreements, setPendingAgreements] = useState<AgreementAssignment[]>([]);

  // Redirect pending_agreement users to agreement page
  if (user?.role === 'pending_agreement') {
    return <Navigate to="/agreement" replace />;
  }

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        // Load recent posts
        const postsResponse = await postsApi.getPosts({ limit: 10, feed: true });
        setRecentPosts(postsResponse.posts || []);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setIsLoading(false);
      }

      // Non-blocking: check for agreements assigned to me awaiting signature
      try {
        const assignments = await agreementsApi.getMyAssignments();
        setPendingAgreements(assignments.filter(a => a.status === 'pending'));
      } catch {
        // banner is best-effort only
      }
    };

    loadDashboardData();
  }, []);


  return (
    <div className="relative">
      {/* Main Content */}
      <div className="space-y-8 xl:mr-96">
        {/* Pending agreement banner (non-blocking) */}
        {pendingAgreements.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            {pendingAgreements.map((a) => (
              <Link
                key={a.id}
                to={`/agreements/${a.id}`}
                className="flex items-center justify-between gap-3 py-1 group"
              >
                <div className="flex items-center gap-3">
                  <FileSignature className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  <span className="text-sm text-amber-900">
                    <span className="font-semibold">An agreement is waiting for your signature:</span>{' '}
                    {a.title}
                  </span>
                </div>
                <span className="text-sm font-semibold text-amber-700 group-hover:text-amber-900 whitespace-nowrap">
                  Review &amp; sign →
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* Enhanced Welcome Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 p-8 shadow-xl">
          <div className="absolute inset-0 bg-black/10"></div>
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl"></div>
          <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-white/10 blur-3xl"></div>
          <div className="relative">
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="h-8 w-8 text-yellow-300" />
              <h1 className="text-4xl font-bold text-white">
                Welcome back, {user?.name}!
              </h1>
            </div>
            <p className="mt-3 text-xl text-white/90">
              {`Here's what's happening in the ${companyName} ecosystem today.`}
            </p>
            <div className="mt-4 text-white/80 flex items-center gap-4">
              <Clock className="h-5 w-5" />
              <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
        </div>



        {/* News Stream - Recent Forum Posts */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg">
                <MessageSquare className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">News Stream</h2>
            </div>
            <Link to="/forum" className="group flex items-center gap-2 text-primary-600 hover:text-primary-700 font-semibold">
              <span>View all posts</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          <div className="space-y-4">
            {isLoading ? (
              <div className="bg-white rounded-xl shadow-md p-8">
                <div className="animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              </div>
            ) : recentPosts.length > 0 ? (
              <div className="grid gap-4">
                {recentPosts.slice(0, 6).map((post, index) => {
                  // Extract first image from content_html if available
                  const imageMatch = post.content_html?.match(/<img[^>]+src="([^"]+)"/i);
                  const imageUrl = imageMatch ? imageMatch[1] : null;
                  const cleanContent = post.content.replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();

                  return (
                    <Link
                      key={post.id}
                      to={`/forum/post/${post.slug}`}
                      className="group bg-white rounded-xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border border-gray-100"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="p-6">
                        <div className="flex gap-4">
                          {/* Post Content */}
                          <div className="flex-1">
                            <h3 className="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors line-clamp-2 mb-2">
                              {post.title}
                            </h3>
                            <p className="text-gray-600 line-clamp-3 mb-3 leading-relaxed">
                              {cleanContent.substring(0, 200)}{cleanContent.length > 200 ? '...' : ''}
                            </p>

                            {/* Post Meta */}
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                              <div className="flex items-center gap-2">
                                {post.avatar_url ? (
                                  <img src={post.avatar_url} alt="" className="h-6 w-6 rounded-full" />
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center">
                                    <span className="text-xs text-white font-bold">
                                      {post.author_name?.charAt(0)}
                                    </span>
                                  </div>
                                )}
                                <span className="font-medium">{post.author_name}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span>{new Date(post.created_at).toLocaleDateString()}</span>
                              </div>
                              {post.view_count > 0 && (
                                <div className="flex items-center gap-1">
                                  <Eye className="h-4 w-4" />
                                  <span>{post.view_count} views</span>
                                </div>
                              )}
                              {post.comment_count !== undefined && post.comment_count > 0 && (
                                <div className="flex items-center gap-1">
                                  <MessageCircle className="h-4 w-4" />
                                  <span>{post.comment_count} comments</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Thumbnail if image exists */}
                          {imageUrl && (
                            <div className="flex-shrink-0">
                              <div className="h-24 w-24 rounded-lg overflow-hidden bg-gray-100">
                                <img
                                  src={imageUrl}
                                  alt=""
                                  className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-300"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Hover indicator */}
                      <div className="h-1 bg-gradient-to-r from-primary-500 via-purple-500 to-pink-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
                    </Link>
                  );
                })}

                {recentPosts.length > 6 && (
                  <Link
                    to="/forum"
                    className="bg-gradient-to-r from-primary-50 to-purple-50 rounded-xl p-6 text-center hover:from-primary-100 hover:to-purple-100 transition-all border border-primary-200"
                  >
                    <p className="text-primary-700 font-semibold">+ {recentPosts.length - 6} more posts</p>
                    <p className="text-primary-600 text-sm mt-1">Click to view all discussions</p>
                  </Link>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md p-12 text-center">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-xl font-semibold text-gray-700 mb-2">No posts yet</p>
                <p className="text-gray-500 mb-6">Be the first to start a discussion!</p>
                <Link to="/forum/create" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white font-semibold rounded-lg hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg">
                  <MessageSquare className="h-5 w-5" />
                  <span>Create First Post</span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced User Profile Card */}
        <div className="relative overflow-hidden bg-white rounded-xl shadow-lg border border-gray-100">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-transparent to-purple-50 opacity-50"></div>
          <div className="relative p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">Your Profile</h3>
              <span className="px-3 py-1 bg-gradient-to-r from-primary-100 to-purple-100 text-primary-700 text-sm font-semibold rounded-full">
                {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User'}
              </span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex-shrink-0">
                {user?.avatar_url ? (
                  <div className="relative">
                    <img
                      src={user.avatar_url}
                      alt={`${user.name} profile`}
                      className="h-20 w-20 rounded-2xl object-cover shadow-xl"
                    />
                    <div className="absolute -bottom-1 -right-1 h-6 w-6 bg-green-500 rounded-full border-2 border-white"></div>
                  </div>
                ) : (
                  <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-xl">
                    <span className="text-2xl font-bold text-white">
                      {user?.name?.charAt(0) || user?.email?.charAt(0)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-gray-900">{user?.name}</p>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  {(user?.intranet_username || user?.github_username) && (
                    <>
                      <span className="text-gray-600 font-medium">@{user?.intranet_username || user?.github_username}</span>
                      <span className="text-gray-400">|</span>
                    </>
                  )}
                  <span className="text-gray-500">{user?.email}</span>
                </div>
                {user?.bio && (
                  <p className="mt-3 text-gray-600 italic">\{user.bio.substring(0, 100)}...</p>
                )}
              </div>
              <div>
                <Link
                  to={`/profile/${user?.intranet_username || `id:${user?.id}`}`}
                  className="group inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white font-semibold rounded-lg hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg"
                >
                  <span>View Profile</span>
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Quicklinks on mobile - show at bottom */}
        <div className="xl:hidden">
          <Quicklinks />
        </div>
      </div>

      {/* Right Sidebar - Absolutely positioned on large screens */}
      <div className="hidden xl:block fixed top-24 right-8 w-80 z-10">
        <div className="sticky top-24">
          <Quicklinks />
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;