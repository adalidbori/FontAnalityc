/**
 * Authentication utilities for Front Analytics
 */
const Auth = {
  // Current user data (cached)
  currentUser: null,

  /**
   * Check authentication status and redirect if not authenticated
   */
  async checkAuth() {
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();

      if (!data.authenticated) {
        window.location.href = '/login.html';
        return null;
      }

      this.currentUser = data.user;
      return data.user;
    } catch (error) {
      console.error('Auth check failed:', error);
      window.location.href = '/login.html';
      return null;
    }
  },

  /**
   * Check if current user has admin role
   */
  async checkAdmin() {
    const user = await this.checkAuth();
    if (!user) return false;

    if (user.role !== 'admin') {
      window.location.href = '/access-denied.html';
      return false;
    }
    return true;
  },

  /**
   * Get current user info
   */
  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;

    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        this.currentUser = await response.json();
        return this.currentUser;
      }
      return null;
    } catch (error) {
      console.error('Failed to get user:', error);
      return null;
    }
  },

  /**
   * Logout the current user
   */
  logout() {
    window.location.href = '/auth/logout';
  },

  /**
   * Add user header to the page
   */
  async renderUserHeader(containerId = 'user-header') {
    const user = await this.getCurrentUser();
    if (!user) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">
          ${user.name.charAt(0).toUpperCase()}
        </div>
        <div class="user-details">
          <span class="user-name">${user.name}</span>
          <span class="user-role">${user.role === 'admin' ? 'Administrator' : 'User'}</span>
        </div>
        <button onclick="Auth.logout()" class="btn-logout" title="Logout">
          <i class="fas fa-sign-out-alt"></i>
        </button>
      </div>
    `;
  }
};

// Export for use in other scripts
window.Auth = Auth;
