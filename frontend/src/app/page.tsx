"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Music, Home as HomeIcon, Mic2 } from 'lucide-react';
import { getNoSleep } from '@/utils/noSleep';
import styles from './page.module.css';

const LyricsBadge = ({ videoId, title, artist }: { videoId: string, title: string, artist: string }) => {
  const [status, setStatus] = useState<'loading' | 'available' | 'none'>('loading');
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const cacheKey = `lyrics_avail_${videoId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      setStatus(cached as any);
      return;
    }

    const controller = new AbortController();
    let isMounted = true;
    
    fetch(`/api/lyrics/${videoId}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        const resStatus = data.lrc ? 'available' : 'none';
        setStatus(resStatus);
        sessionStorage.setItem(cacheKey, resStatus);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (isMounted) setStatus('none');
      });
      
    return () => { 
      isMounted = false; 
      controller.abort(); 
    };
  }, [videoId, title, artist, isVisible]);

  return (
    <div ref={containerRef} style={{height: '24px'}}>
      {isVisible && status === 'loading' && <div className={styles.lyricsBadgeLoading}>Checking lyrics...</div>}
      {status === 'available' && <div className={styles.lyricsBadgeAvailable}><Mic2 size={12} style={{marginRight: 4}}/> Lyrics Available</div>}
    </div>
  );
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [listenMode, setListenMode] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const savedQuery = sessionStorage.getItem('searchQuery');
    const savedResults = sessionStorage.getItem('searchResults');
    const savedMode = sessionStorage.getItem('listenMode');
    if (savedQuery) setQuery(savedQuery);
    if (savedMode === 'false') setListenMode(false);
    if (savedMode === 'true') setListenMode(true);
    if (savedResults) {
      try {
        setResults(JSON.parse(savedResults));
      } catch (e) {}
    }
  }, []);

  const toggleListenMode = () => {
    setListenMode(prev => {
      const next = !prev;
      sessionStorage.setItem('listenMode', next.toString());
      return next;
    });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data);
      sessionStorage.setItem('searchQuery', query);
      sessionStorage.setItem('searchResults', JSON.stringify(data));
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const getCleanThumbnail = (video: any) => {
    if (!video.thumbnails || video.thumbnails.length === 0) return '';
    let url = video.thumbnails[video.thumbnails.length - 1].url;
    if (url.includes('i.ytimg.com')) {
      return url.split('?')[0];
    }
    // Upscale yt3 images safely now that we have no-referrer policy
    if (url.includes('=w')) {
      return url.replace(/=w\d+-h\d+(?:-[a-zA-Z0-9\-]+)?/, '=w544-h544');
    }
    return url;
  };

  const handlePlay = (video: any) => {
    setIsNavigating(true);
    
    // Enable NoSleep immediately upon user interaction to bypass iOS strict policies
    const noSleep = getNoSleep();
    if (noSleep) noSleep.enable();

    // Navigate to player page with data
    const params = new URLSearchParams({
      id: video.videoId,
      title: video.title,
      artist: video.artists[0] || 'Unknown Artist',
      cover: getCleanThumbnail(video),
      mode: listenMode ? 'listen' : 'karaoke'
    });
    router.push(`/player?${params.toString()}`);
  };

  return (
    <main className={styles.container}>
      {results.length > 0 && (
        <button 
          onClick={() => {
            sessionStorage.removeItem('searchQuery');
            sessionStorage.removeItem('searchResults');
            setQuery('');
            setResults([]);
          }} 
          style={{position:'absolute', top:'2rem', left:'2rem', color: 'white', background: 'rgba(255,255,255,0.1)', padding: '0.75rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.2s ease', border: '1px solid rgba(255,255,255,0.2)', zIndex: 100}}
          title="Clear Search"
        >
          <HomeIcon size={24} />
        </button>
      )}
      <div className={styles.hero}>
        <div className={styles.iconContainer} style={{marginBottom: '1rem'}}>
          <img src="/logo.png" alt="VocalDrop" width={96} height={96} style={{borderRadius: '24px', boxShadow: '0 10px 30px rgba(250, 36, 60, 0.4)'}} />
        </div>
        <h1 className={styles.title}>VocalDrop</h1>
        <p className={styles.subtitle}>On-the-fly vocal separation for any song.</p>
        
        <form onSubmit={handleSearch} className={styles.searchForm}>
          <div className={styles.searchBar}>
            <Search className={styles.searchIcon} size={20} />
            <input
              type="text"
              placeholder="Search for songs, artists, or albums..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.searchInput}
            />
            <button type="submit" className={styles.searchButton}>
              Search
            </button>
          </div>
          
          <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: listenMode ? '#fff' : '#888', transition: 'color 0.2s', fontWeight: listenMode ? 600 : 400 }}>Listen Only</span>
            <div 
              onClick={toggleListenMode}
              style={{
                width: '48px', height: '24px', background: listenMode ? '#333' : 'var(--apple-red)', borderRadius: '99px',
                position: 'relative', cursor: 'pointer', transition: 'background 0.3s'
              }}
            >
              <div style={{
                width: '20px', height: '20px', background: '#fff', borderRadius: '50%',
                position: 'absolute', top: '2px', left: listenMode ? '2px' : '26px', transition: 'left 0.3s'
              }} />
            </div>
            <span style={{ fontSize: '0.9rem', color: !listenMode ? '#fff' : '#888', transition: 'color 0.2s', fontWeight: !listenMode ? 600 : 400 }}>Karaoke Mode</span>
          </div>
        </form>
      </div>

      {loading && !isNavigating && <div className={styles.loading}>Searching...</div>}
      {isNavigating && <div className={styles.loading}>Opening player...</div>}

      {!isNavigating && (
        <div className={styles.resultsGrid}>
          {results.map((r: any) => (
            <div key={r.videoId} className={styles.resultCard} onClick={() => handlePlay(r)}>
            <div className={styles.coverWrapper}>
              {r.thumbnails && r.thumbnails.length > 0 ? (
                <img src={getCleanThumbnail(r)} alt={r.title} className={styles.cover} referrerPolicy="no-referrer" />
              ) : (
                <div className={styles.cover} style={{backgroundColor: '#333'}} />
              )}
              <div className={styles.playOverlay}>
                <Music size={24} />
              </div>
            </div>
            <div className={styles.cardInfo}>
              <h3 className={styles.cardTitle}>{r.title}</h3>
              <p className={styles.cardArtist}>{r.artists.join(', ')}</p>
              <LyricsBadge videoId={r.videoId} title={r.title} artist={r.artists[0] || 'Unknown Artist'} />
            </div>
          </div>
        ))}
        </div>
      )}
    </main>
  );
}
