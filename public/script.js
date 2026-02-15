// Common functions used across all pages

// Create a card element for movie/TV show
function createCard(item, type) {
    const card = document.createElement('div');
    card.className = 'card';
    
    const posterUrl = item.movieposter 
        ? `https://image.tmdb.org/t/p/w500/${item.movieposter}`
        : 'https://via.placeholder.com/200x300?text=No+Poster';
    
    const url = type === 'tv' ? `/tvshow/${item.moviekey}` : `/movie/${item.moviekey}`;
    
    card.innerHTML = `
        <img src="${posterUrl}" alt="${item.moviename || 'Unknown'}" loading="lazy">
        ${item.movierating ? `<div class="card-badge">⭐ ${item.movierating}</div>` : ''}
        <div class="card-content">
            <div class="card-title">${item.moviename || 'Unknown Title'}</div>
            <div class="card-meta">
                ${item.movieyear ? `<span>${item.movieyear}</span>` : ''}
                ${type === 'tv' ? '<span>TV</span>' : '<span>Movie</span>'}
            </div>
        </div>
    `;
    
    card.onclick = () => {
        window.location.href = url;
    };
    
    return card;
}

// Search functionality
let searchTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const searchResults = document.getElementById('searchResults');
    const resultsGrid = document.getElementById('resultsGrid');
    const closeSearch = document.getElementById('closeSearch');

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', performSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        // Auto-search as user types (with debounce)
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length >= 2) {
                searchTimeout = setTimeout(() => {
                    performSearch();
                }, 500);
            } else if (query.length === 0) {
                hideSearchResults();
            }
        });
    }

    if (closeSearch) {
        closeSearch.addEventListener('click', hideSearchResults);
    }

    // Close search on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchResults) {
            hideSearchResults();
        }
    });
});

async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const resultsGrid = document.getElementById('resultsGrid');
    
    const query = searchInput.value.trim();
    
    if (query.length < 2) {
        return;
    }

    // Show search results overlay
    searchResults.style.display = 'block';
    resultsGrid.innerHTML = '<div class="loader"></div>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        resultsGrid.innerHTML = '';

        if (data.success && data.results.length > 0) {
            data.results.forEach(item => {
                const type = item.isTV ? 'tv' : 'movie';
                const card = createCard(item, type);
                resultsGrid.appendChild(card);
            });
        } else {
            resultsGrid.innerHTML = '<p class="no-content">No results found</p>';
        }
    } catch (error) {
        console.error('Search error:', error);
        resultsGrid.innerHTML = '<p class="error">Search failed. Please try again.</p>';
    }
}

function hideSearchResults() {
    const searchResults = document.getElementById('searchResults');
    const searchInput = document.getElementById('searchInput');
    
    if (searchResults) {
        searchResults.style.display = 'none';
    }
    
    if (searchInput) {
        searchInput.value = '';
    }
}

function showError(message) {
    alert(message);
}

// Format duration
function formatDuration(minutes) {
    if (!minutes) return '';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// Format date
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

// Copy to clipboard
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showNotification('Link copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            fallbackCopyToClipboard(text);
        });
    } else {
        fallbackCopyToClipboard(text);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        document.execCommand('copy');
        showNotification('Link copied to clipboard!');
    } catch (err) {
        console.error('Fallback copy failed:', err);
        showNotification('Failed to copy link', 'error');
    }
    
    document.body.removeChild(textArea);
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background-color: ${type === 'success' ? '#28a745' : '#dc3545'};
        color: white;
        padding: 15px 25px;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 3000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Handle network errors
window.addEventListener('online', () => {
    showNotification('Connection restored', 'success');
});

window.addEventListener('offline', () => {
    showNotification('No internet connection', 'error');
});

// Smooth scroll to top
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Lazy load images
if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
                observer.unobserve(img);
            }
        });
    });

    // Observe all images with data-src attribute
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    });
}
