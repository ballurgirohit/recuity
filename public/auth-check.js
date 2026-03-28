// Authentication check and logout functionality
(async function() {
  const currentUser = { username: null, email: null, role: null };

  async function checkAuth() {
    try {
      const response = await fetch('/api/auth/me');
      if (!response.ok) {
        window.location.href = '/login.html';
        return false;
      }
      const data = await response.json();
      currentUser.username = data.user.username;
      currentUser.email = data.user.email;
      currentUser.role = data.user.role;
      updateUserDisplay();
      return true;
    } catch (error) {
      window.location.href = '/login.html';
      return false;
    }
  }

  function updateUserDisplay() {
    const userDisplay = document.getElementById('user-display');
    if (userDisplay && currentUser.username) {
      const roleEmoji = {
        admin: '👑',
        manager: '👔',
        viewer: '👤'
      };
      const emoji = roleEmoji[currentUser.role] || '👤';
      userDisplay.textContent = `${emoji} ${currentUser.username} (${currentUser.role})`;
      userDisplay.style.display = 'inline-block';
    }

    // Show/hide admin link
    const adminLink = document.getElementById('admin-link');
    if (adminLink) {
      adminLink.style.display = currentUser.role === 'admin' ? '' : 'none';
    }

    // Disable edit buttons for viewers
    if (currentUser.role === 'viewer') {
      disableEditControls();
    }
  }

  function disableEditControls() {
    // Disable all save/delete buttons for viewers
    const saveButtons = document.querySelectorAll('[id$="SaveBtn"], [id$="saveBtn"]');
    const deleteButtons = document.querySelectorAll('[data-action="delete"]');
    
    saveButtons.forEach(btn => {
      btn.disabled = true;
      btn.title = 'Viewers cannot edit data';
    });
    
    deleteButtons.forEach(btn => {
      btn.disabled = true;
      btn.title = 'Viewers cannot delete data';
    });
  }

  async function logout() {
    if (!confirm('Are you sure you want to logout?')) return;
    
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (error) {
      alert('Logout failed. Please try again.');
    }
  }

  // Expose globally
  window.logout = logout;
  window.currentUser = currentUser;

  // Check authentication on page load
  await checkAuth();
})();
