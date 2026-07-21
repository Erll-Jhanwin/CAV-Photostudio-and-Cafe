import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Camera, Coffee, ChevronRight, ChevronLeft, MessageSquare, Send, X,
  ArrowRight, Star, MapPin, Clock, Phone, Menu, Check,
  User, Users, Heart, Cake, CalendarCheck
} from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../api/config';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton';
import { ChatbotFaqPrompts, ChatbotMessageContent } from '../components/ui/ChatbotMessage';
import { normalizeGalleryImages, normalizeRowsById, normalizeServices, recordKey, uniqueBy } from '../utils/uniqueRecords';
import { brandAssets, businessAssets, decorateServicesWithAssets, localGalleryImages } from '../utils/cavAssets';

function LandingSkeleton() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-40 bg-white border-b border-espresso/[0.08] shadow-[0_8px_24px_rgba(46,26,17,0.06)]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="hidden md:flex gap-8">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-4 w-16" />)}
          </div>
          <Skeleton className="h-10 w-24 rounded-full" />
        </div>
      </header>
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-6">
            <Skeleton className="h-8 w-48 rounded-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="h-5 w-96" />
            <div className="flex gap-4 pt-4">
              <Skeleton className="h-14 w-44 rounded-full" />
              <Skeleton className="h-14 w-44 rounded-full" />
            </div>
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="h-[450px] w-full rounded-3xl" />
          </div>
        </div>
      </section>
      <section className="py-24 px-6 bg-cream-dark">
        <div className="max-w-7xl mx-auto space-y-12 text-center">
          <div className="space-y-4 max-w-xl mx-auto">
            <Skeleton className="h-5 w-40 mx-auto" />
            <Skeleton className="h-10 w-80 mx-auto" />
            <Skeleton className="h-4 w-96 mx-auto" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </section>
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto space-y-12 text-center">
          <div className="space-y-4 max-w-xl mx-auto">
            <Skeleton className="h-5 w-32 mx-auto" />
            <Skeleton className="h-10 w-80 mx-auto" />
            <Skeleton className="h-4 w-96 mx-auto" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function CafeCarousel({ items = [] }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const autoplayTimerRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    translate: 0,
  });
  const [cardsPerView, setCardsPerView] = useState(2);
  const [cardWidth, setCardWidth] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);

  const visibleCards = Math.min(cardsPerView, Math.max(items.length, 1));
  const maxIndex = Math.max(0, items.length - visibleCards);
  const canSlide = items.length > visibleCards;
  const activeIndex = Math.min(items.length - 1, currentIndex + Math.floor((visibleCards - 1) / 2));
  const slideTransition = 'transform 480ms ease-in-out';

  const getCardsPerView = useCallback(() => {
    if (window.innerWidth >= 1280) return 5;
    if (window.innerWidth >= 1024) return 4;
    if (window.innerWidth >= 640) return 3;
    return 2;
  }, []);

  const applyTranslate = useCallback((value, animated = true) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = animated ? slideTransition : 'none';
    track.style.transform = `translate3d(${value}px, 0, 0)`;
    dragRef.current.translate = value;
  }, [slideTransition]);

  const snapToIndex = useCallback((index, animated = true) => {
    const nextIndex = Math.min(Math.max(index, 0), maxIndex);
    setCurrentIndex(nextIndex);
    applyTranslate(-nextIndex * cardWidth, animated);
  }, [applyTranslate, cardWidth, maxIndex]);

  const pauseAutoplay = useCallback(() => {
    setIsInteracting(true);
    window.clearTimeout(resumeTimerRef.current);
  }, []);

  const resumeAutoplaySoon = useCallback(() => {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setIsInteracting(false), 3500);
  }, []);

  useEffect(() => {
    const updateMeasurements = () => {
      const nextCardsPerView = getCardsPerView();
      const width = viewportRef.current?.clientWidth || 0;
      setCardsPerView(nextCardsPerView);
      setCardWidth(width / Math.min(nextCardsPerView, Math.max(items.length, 1)));
    };

    updateMeasurements();
    window.addEventListener('resize', updateMeasurements);
    return () => window.removeEventListener('resize', updateMeasurements);
  }, [getCardsPerView, items.length]);

  useEffect(() => {
    snapToIndex(currentIndex, false);
  }, [cardWidth, currentIndex, snapToIndex, visibleCards]);

  useEffect(() => {
    if (!canSlide || isInteracting) {
      window.clearInterval(autoplayTimerRef.current);
      return undefined;
    }

    autoplayTimerRef.current = window.setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev >= maxIndex ? 0 : prev + 1;
        applyTranslate(-next * cardWidth, true);
        return next;
      });
    }, 4200);

    return () => window.clearInterval(autoplayTimerRef.current);
  }, [applyTranslate, canSlide, cardWidth, isInteracting, maxIndex]);

  useEffect(() => () => {
    window.clearTimeout(resumeTimerRef.current);
    window.clearInterval(autoplayTimerRef.current);
  }, []);

  const handlePointerDown = (event) => {
    if (!canSlide) return;
    pauseAutoplay();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
      translate: -currentIndex * cardWidth,
    };
    applyTranslate(dragRef.current.translate, false);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const now = performance.now();
    const deltaX = event.clientX - drag.lastX;
    const elapsed = Math.max(now - drag.lastTime, 16);
    const minTranslate = -maxIndex * cardWidth;
    const nextTranslate = Math.min(0, Math.max(minTranslate, drag.translate + deltaX));

    drag.velocity = deltaX / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = now;
    drag.translate = nextTranslate;
    applyTranslate(nextTranslate, false);
  };

  const finishDrag = (event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    drag.active = false;
    const momentum = drag.velocity * 180;
    const targetTranslate = drag.translate + momentum;
    const targetIndex = Math.round(Math.abs(targetTranslate) / Math.max(cardWidth, 1));
    snapToIndex(targetIndex, true);
    resumeAutoplaySoon();
  };

  const goToIndex = (index) => {
    pauseAutoplay();
    snapToIndex(index, true);
    resumeAutoplaySoon();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToIndex(currentIndex >= maxIndex ? 0 : currentIndex + 1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToIndex(currentIndex <= 0 ? maxIndex : currentIndex - 1);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      goToIndex(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      goToIndex(maxIndex);
    }
  };

  if (!items.length) {
    return (
      <div className="rounded-3xl border border-gold/15 bg-espresso-dark/95 p-8 text-center text-cream/60">
        Café menu items are loading.
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={pauseAutoplay}
      onMouseLeave={resumeAutoplaySoon}
    >
      <div
        ref={viewportRef}
        role="region"
        aria-label="Café menu carousel"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className="overflow-hidden rounded-[1.75rem] cursor-grab active:cursor-grabbing touch-pan-y select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        <div
          ref={trackRef}
          className="flex will-change-transform motion-reduce:transition-none"
          style={{
            transform: 'translate3d(0, 0, 0)',
            backfaceVisibility: 'hidden',
          }}
        >
          {items.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <div
                key={item.id}
                className="shrink-0 px-2 sm:px-3 md:px-4"
                style={{ width: cardWidth || `${100 / visibleCards}%` }}
                aria-hidden={idx < currentIndex || idx >= currentIndex + visibleCards}
              >
                <article
                  className={`relative h-full bg-espresso-dark p-3 md:p-4 rounded-3xl border flex flex-col group overflow-hidden transition-[transform,box-shadow,border-color,opacity] duration-[480ms] ease-in-out will-change-transform animate-in-up ${
                    isActive
                      ? 'scale-[1.03] border-gold/50 shadow-[0_0_0_1px_rgba(212,175,55,0.16),0_24px_60px_rgba(212,175,55,0.22),0_18px_45px_rgba(28,15,10,0.32)]'
                      : 'scale-[0.95] border-gold/10 opacity-90 shadow-[0_18px_45px_rgba(28,15,10,0.22)] hover:opacity-100 hover:scale-[0.99] hover:border-gold/30 hover:shadow-[0_20px_52px_rgba(28,15,10,0.30)]'
                  }`}
                  style={{
                    animationDelay: `${idx * 70}ms`,
                    backfaceVisibility: 'hidden',
                  }}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(212,175,55,0.22),transparent_48%)] transition-opacity duration-[480ms] ease-in-out ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
                    }`}
                  />
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-4 bg-charcoal-dark">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        loading="lazy"
                        draggable="false"
                        style={{ objectPosition: item.image_position || item.object_position || '50% 34%' }}
                        className="w-full h-full object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-espresso text-gold">
                        <Coffee className="h-12 w-12" />
                      </div>
                    )}
                  </div>
                  <div className="relative flex flex-col gap-2 mb-4">
                    <h3 className="font-sans text-sm sm:text-base md:text-lg font-bold text-cream leading-tight">{item.name}</h3>
                    <span className="text-gold font-bold text-xs md:text-sm transition-colors duration-300 group-hover:text-gold-light">PHP {item.price}</span>
                  </div>
                  <div className="relative mt-auto pt-3 border-t border-cream/10 flex justify-between items-center text-[10px] md:text-[11px] text-cream/55">
                    <span>Fresh daily</span>
                    <span className="bg-gold/15 text-gold font-bold px-2 py-0.5 rounded-md uppercase text-[8px] md:text-[9px] transition-all duration-300 ease-in-out group-hover:bg-gold/25 group-hover:shadow-[0_0_18px_rgba(212,175,55,0.22)]">Available</span>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>

      {canSlide && (
        <>
          <button
            type="button"
            onClick={() => goToIndex(currentIndex <= 0 ? maxIndex : currentIndex - 1)}
            className="group hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 lg:-translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-espresso-dark text-gold border border-gold/25 shadow-lg hover:scale-110 hover:-translate-x-4 lg:hover:-translate-x-6 hover:bg-espresso hover:shadow-[0_0_24px_rgba(212,175,55,0.24)] active:scale-95 transition-all duration-300 ease-in-out"
            aria-label="Previous café item"
          >
            <ChevronLeft className="w-5 h-5 transition-transform duration-300 ease-in-out group-hover:-translate-x-0.5" />
          </button>
          <button
            type="button"
            onClick={() => goToIndex(currentIndex >= maxIndex ? 0 : currentIndex + 1)}
            className="group hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 lg:translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-espresso-dark text-gold border border-gold/25 shadow-lg hover:scale-110 hover:translate-x-4 lg:hover:translate-x-6 hover:bg-espresso hover:shadow-[0_0_24px_rgba(212,175,55,0.24)] active:scale-95 transition-all duration-300 ease-in-out"
            aria-label="Next café item"
          >
            <ChevronRight className="w-5 h-5 transition-transform duration-300 ease-in-out group-hover:translate-x-0.5" />
          </button>
        </>
      )}

      {canSlide && (
        <div className="flex items-center justify-center gap-2 pt-6" aria-label="Café menu pagination">
          {Array.from({ length: maxIndex + 1 }).map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => goToIndex(idx)}
              className={`h-2 rounded-full transition-[width,background-color,box-shadow,transform] duration-300 ease-in-out hover:scale-125 ${
                idx === currentIndex ? 'w-8 bg-gold shadow-[0_0_16px_rgba(212,175,55,0.45)]' : 'w-2 bg-espresso/25 hover:bg-gold/60'
              }`}
              aria-label={`Go to café menu slide ${idx + 1}`}
              aria-current={idx === currentIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const GALLERY_CATEGORIES = [
  { label: 'All', value: 'ALL' },
  { label: 'Studio', value: 'STUDIO' },
  { label: 'Café', value: 'CAFE' },
  { label: 'Events', value: 'EVENTS' },
  { label: 'Behind the Scenes', value: 'BEHIND_THE_SCENES' },
];

const fallbackGalleryImages = localGalleryImages;

function GallerySection({ images = [] }) {
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const touchStartRef = useRef(null);
  const galleryImages = (images.length ? images : fallbackGalleryImages).filter(item => item.image_url);
  const availableCategories = GALLERY_CATEGORIES.filter(category => (
    category.value === 'ALL' || galleryImages.some(item => item.category === category.value)
  ));
  const filteredImages = activeCategory === 'ALL'
    ? galleryImages
    : galleryImages.filter(item => item.category === activeCategory);
  const activeImage = lightboxIndex !== null ? filteredImages[lightboxIndex] : null;

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const showPrevious = useCallback(() => {
    setLightboxIndex(index => {
      if (index === null || filteredImages.length === 0) return index;
      return index === 0 ? filteredImages.length - 1 : index - 1;
    });
  }, [filteredImages.length]);
  const showNext = useCallback(() => {
    setLightboxIndex(index => {
      if (index === null || filteredImages.length === 0) return index;
      return index === filteredImages.length - 1 ? 0 : index + 1;
    });
  }, [filteredImages.length]);

  useEffect(() => {
    setLightboxIndex(null);
  }, [activeCategory]);

  useEffect(() => {
    if (!activeImage) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowLeft') showPrevious();
      if (event.key === 'ArrowRight') showNext();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeImage, closeLightbox, showNext, showPrevious]);

  const handleTouchStart = (event) => {
    touchStartRef.current = event.touches[0].clientX;
  };

  const handleTouchEnd = (event) => {
    if (touchStartRef.current === null) return;
    const diff = touchStartRef.current - event.changedTouches[0].clientX;
    touchStartRef.current = null;
    if (Math.abs(diff) < 48) return;
    if (diff > 0) showNext();
    else showPrevious();
  };

  return (
    <section id="gallery" className="premium-section bg-cream-dark">
      <div className="max-w-[1400px] mx-auto space-y-10 md:space-y-14">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="space-y-5 max-w-3xl">
            <span className="text-gold font-bold uppercase tracking-[0.18em] text-xs md:text-sm">Gallery</span>
            <h2 className="font-sans text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.04] text-espresso text-balance">
              Studio moments, café details, and finished sessions
            </h2>
            <p className="text-espresso/70 text-base md:text-lg leading-relaxed">
              Browse recent scenes from CAV, curated by category and updated from the admin gallery.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end" aria-label="Gallery category filters">
            {availableCategories.map(category => (
              <button
                key={category.value}
                type="button"
                onClick={() => setActiveCategory(category.value)}
                className={`px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 ${
                  activeCategory === category.value
                    ? 'bg-espresso text-gold shadow-[0_14px_34px_rgba(46,26,17,0.16)]'
                    : 'bg-white/80 text-espresso/68 border border-espresso/[0.06] hover:bg-white hover:text-espresso'
                }`}
                aria-pressed={activeCategory === category.value}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        {filteredImages.length > 0 ? (
          <div className="gallery-grid">
            {filteredImages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLightboxIndex(index)}
                className="gallery-grid-item group relative w-full overflow-hidden rounded-[24px] bg-white text-left shadow-[0_18px_45px_rgba(46,26,17,0.08)] hover:shadow-[0_28px_70px_rgba(46,26,17,0.16)] transition-all duration-500 ease-out focus-visible:outline-gold"
                aria-label={`Open ${item.title} in gallery lightbox`}
              >
                <img
                  src={item.image_url}
                  alt={item.alt_text || item.title}
                  loading="lazy"
                  style={{ objectPosition: item.object_position || '50% 34%' }}
                  className="w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.08]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-espresso-dark/84 via-espresso-dark/18 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="absolute inset-x-0 bottom-0 p-5 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
                  <span className="inline-flex bg-gold text-espresso text-[10px] font-extrabold uppercase tracking-[0.16em] px-3 py-1 rounded-full mb-2">
                    {item.category_label || item.category}
                  </span>
                  <h3 className="text-white text-lg font-extrabold leading-tight">{item.title}</h3>
                  {item.caption && <p className="text-cream/78 text-xs mt-1 leading-relaxed">{item.caption}</p>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[24px] border border-espresso/[0.06] bg-white/80 p-8 text-center text-espresso/60">
            Gallery images are being curated.
          </div>
        )}
      </div>

      {activeImage && (
        <div
          className="fixed inset-0 z-[80] bg-espresso-dark/96 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in"
          role="dialog"
          aria-modal="true"
          aria-label="Gallery image viewer"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute right-4 top-4 md:right-6 md:top-6 w-11 h-11 rounded-full bg-white/10 text-cream hover:bg-white/18 transition-all flex items-center justify-center"
            aria-label="Close gallery lightbox"
          >
            <X className="w-5 h-5" />
          </button>

          {filteredImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={showPrevious}
                className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-cream hover:bg-white/18 transition-all flex items-center justify-center"
                aria-label="Previous gallery image"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={showNext}
                className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-cream hover:bg-white/18 transition-all flex items-center justify-center"
                aria-label="Next gallery image"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}

          <figure className="w-full max-w-6xl max-h-[86vh] flex flex-col items-center gap-4">
            <img
              src={activeImage.image_url}
              alt={activeImage.alt_text || activeImage.title}
              className="max-h-[76vh] w-auto max-w-full rounded-[24px] object-contain shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
            />
            <figcaption className="text-center max-w-2xl">
              <span className="text-gold text-[10px] font-extrabold uppercase tracking-[0.18em]">
                {activeImage.category_label || activeImage.category}
              </span>
              <h3 className="text-white text-lg md:text-xl font-extrabold mt-1">{activeImage.title}</h3>
              {activeImage.caption && <p className="text-cream/70 text-sm mt-1">{activeImage.caption}</p>}
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [cafeItems, setCafeItems] = useState([]);
  const [galleryImages, setGalleryImages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [landingSelectedService, setLandingSelectedService] = useState(null);
  const [landingPackageSlide, setLandingPackageSlide] = useState(0);
  const [landingCardsPerSlide, setLandingCardsPerSlide] = useState(2);

  useEffect(() => {
    const handleResize = () => setLandingCardsPerSlide(window.innerWidth < 640 ? 1 : 2);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const parseDescription = (desc) => {
    if (!desc) return { isSplit: false };
    const match = desc.match(/(\d[\d\-–]+\s*(?:person|persons))\s*[/|]\s*(\d+\s*shots?)/i);
    if (match) return { isSplit: true, persons: match[1].trim(), shots: match[2].trim() };
    return { isSplit: false };
  };

  const getPackageIcon = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('solo')) return <User className="w-4 h-4" />;
    if (n.includes('couple') || n.includes('ms.')) return <Heart className="w-4 h-4" />;
    if (n.includes('friend')) return <Users className="w-4 h-4" />;
    if (n.includes('family')) return <Users className="w-4 h-4" />;
    if (n.includes('birthday')) return <Cake className="w-4 h-4" />;
    return <CalendarCheck className="w-4 h-4" />;
  };
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hi there! Welcome to CAV Photo Studio & Café. Ask me anything about our studio rooms, cafe menu, or packages!' }
  ]);
  const [chatFaqPrompts, setChatFaqPrompts] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [servicesRes, productsRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/bookings/services/`),
          axios.get(`${API_BASE_URL}/api/inventory/products/`)
        ]);
        setServices(decorateServicesWithAssets(normalizeServices(servicesRes.data)));
        setCafeItems(normalizeRowsById(productsRes.data.filter(p => p.is_cafe_item)));
      } catch {
        setServices(decorateServicesWithAssets(normalizeServices([
          {
            id: 1,
            name: 'Studio Session',
            description: 'Standard studio photo session packages. Good for solo, couple, family, birthdays, and quick studio shoots.',
            duration_minutes: 60,
            base_price: '1000.00',
            image_url: businessAssets.hero,
            packages: [
              { id: 1, name: 'Solo Package', price: '1000.00', description: '1 person / 5 shots', inclusions: '1 person, 5 shots, studio lighting, backdrop selection, basic retouching, digital soft copies' },
              { id: 2, name: 'Mr. & Ms. / Couple Package', price: '1000.00', description: '2 persons / 10 shots', inclusions: '2 persons, 10 shots, studio lighting, backdrop selection, basic retouching, digital soft copies' },
              { id: 3, name: 'Mr. & Ms. Friends Package', price: '1000.00', description: '3-5 persons / 15 shots', inclusions: '3-5 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies' },
              { id: 4, name: 'Family Package', price: '1500.00', description: '2-6 persons / 15 shots', inclusions: '2-6 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies' },
              { id: 5, name: 'Birthday Package', price: '1500.00', description: '1-4 persons / 15 shots', inclusions: '1-4 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies, birthday props' },
            ]
          },
          {
            id: 2,
            name: 'Photo Service Booking',
            description: 'Full-service booking process for events and extended photoshoots. Includes event/program, booking confirmation, availability, shoot layout, setup, printing, and final file record.',
            duration_minutes: 120,
            base_price: '2500.00',
            image_url: businessAssets.store,
            packages: [
              { id: 6, name: 'Standard Event Package', price: '2500.00', description: '2 hours event/program photoshoot', inclusions: '2 hours coverage, availability validation, layout setup, printing coordination, final digital file record' }
            ]
          },
        ])));
        setCafeItems(normalizeRowsById([
          { id: 1, name: 'Espresso', price: '90.00' },
          { id: 2, name: 'Iced Latte', price: '130.00' },
          { id: 3, name: 'Chocolate Croissant', price: '85.00' },
        ]));
      }

      setGalleryImages(normalizeGalleryImages(localGalleryImages));
      setLoaded(true);
    }
    fetchData();
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/chatbot/faqs/`)
      .then(res => {
        const prompts = uniqueBy(res.data.map(faq => faq.question).filter(Boolean), question => question.toLowerCase()).slice(0, 6);
        if (prompts.length) setChatFaqPrompts(prompts);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!landingSelectedService) return;
    const currentService = services.find(service => recordKey(service, service.name) === recordKey(landingSelectedService, landingSelectedService.name));
    if (!currentService) {
      setLandingSelectedService(null);
      setLandingPackageSlide(0);
    } else if (currentService !== landingSelectedService) {
      setLandingSelectedService(currentService);
    }
  }, [services, landingSelectedService]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = useCallback(async (message) => {
    const msg = message.trim();
    if (!msg || chatLoading) return;
    setChatMessages(p => [...p, { role: 'user', content: msg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/chatbot/query/`, { question: msg });
      setChatMessages(p => [...p, { role: 'assistant', content: res.data.response }]);
    } catch {
      let answer = 'Thanks for asking!\n\nWe are open daily from 9:00 AM to 8:00 PM at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.';
      const q = msg.toLowerCase();
      if (q.includes('hour') || q.includes('time')) answer = 'CAV Photo Studio and Cafe is open daily from 9:00 AM to 8:00 PM.';
      else if (q.includes('price') || q.includes('package')) answer = 'Our packages include:\n- Solo, Couple, and Friends packages: PHP 1,000\n- Family and Birthday packages: PHP 1,500\n- Standard Event Package: PHP 2,500';
      else if (q.includes('location') || q.includes('where')) answer = 'We are located at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.';
      else if (q.includes('email') || q.includes('contact')) answer = 'You can reach us at cav.photostudio.cafe@gmail.com or find us on Facebook and Instagram as CAV Photo Studio & Cafe.';
      setChatMessages(p => [...p, { role: 'assistant', content: answer }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatLoading]);

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    await sendChatMessage(chatInput);
  };

  const handleBookNow = () => {
    if (user) navigate('/customer');
    else navigate('/login?redirect=book');
  };

  const navLinks = [
    { label: 'Home', href: '#hero' },
    { label: 'Photo Studio', href: '#studio' },
    { label: 'Café Menu', href: '#cafe' },
    { label: 'Gallery', href: '#gallery' },
    { label: 'Our Story', href: '#about' },
  ];

  if (!loaded) return <LandingSkeleton />;

  return (
    <div className="min-h-screen bg-cream flex flex-col relative page-transition">
      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-espresso/[0.08] bg-white shadow-[0_8px_24px_rgba(46,26,17,0.06)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4 md:h-[72px]">
            <Link to="/" className="flex min-w-0 items-center gap-3 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-espresso text-gold shadow-[0_8px_18px_rgba(46,26,17,0.14)]">
                <img src={brandAssets.logo} alt="CAV logo" className="h-7 w-7 rounded-xl object-cover" />
              </div>
              <div className="min-w-0">
                <span className="block truncate font-sans text-lg font-black leading-tight text-espresso md:text-xl">CAV</span>
                <span className="hidden text-[9px] font-bold uppercase leading-tight tracking-[0.18em] text-gold-dark sm:block">Studio &amp; Café</span>
              </div>
            </Link>

            <nav className="hidden items-center justify-center gap-1 text-sm font-bold md:flex">
              {navLinks.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl px-3.5 py-2 text-espresso/68 transition-colors hover:bg-cream hover:text-espresso focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold lg:px-4"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {user ? (
                <Link
                  to={user.role === 'ADMIN' ? '/admin' : user.role === 'STAFF' ? '/staff' : '/customer'}
                  className="rounded-2xl bg-espresso px-4 py-2.5 text-sm font-black text-gold shadow-[0_8px_18px_rgba(46,26,17,0.14)] transition-colors hover:bg-espresso-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="hidden rounded-2xl px-3 py-2 text-sm font-bold text-espresso/68 transition-colors hover:bg-cream hover:text-espresso focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:block">
                    Access Account
                  </Link>
                  <Button variant="gold" size="sm" onClick={handleBookNow} className="hidden rounded-2xl px-4 font-black sm:inline-flex">
                    Reserve <span className="hidden lg:inline">Your Session</span> <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
              <button
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-espresso/10 bg-white text-espresso transition-colors hover:bg-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold md:hidden"
                aria-expanded={mobileNavOpen}
                aria-label="Toggle navigation"
              >
                {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
        {mobileNavOpen && (
          <div className="border-t border-espresso/[0.08] bg-white md:hidden">
            <div className="mx-auto max-w-7xl space-y-1 px-4 py-3">
              {navLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-sm font-bold text-espresso/72 transition-colors hover:bg-cream hover:text-espresso focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  {item.label}
                </a>
              ))}
              {!user && (
                <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                  <Link
                    to="/login"
                    onClick={() => setMobileNavOpen(false)}
                    className="inline-flex items-center justify-center rounded-2xl border border-espresso/10 bg-white px-4 py-3 text-sm font-black text-espresso transition-colors hover:bg-cream"
                  >
                    Access Account
                  </Link>
                  <Button variant="gold" size="sm" onClick={() => { setMobileNavOpen(false); handleBookNow(); }} className="justify-center rounded-2xl py-3 font-black">
                    Reserve Your Session
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section id="hero" className="relative flex-grow flex items-center min-h-[calc(100vh-4rem)] premium-section bg-gradient-to-br from-espresso-dark via-espresso to-espresso-light text-cream overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gold via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(28,15,10,0.22),transparent_45%,rgba(212,175,55,0.05))]" />
        <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-20">
          <div className="min-w-0 space-y-8 md:space-y-10 lg:col-span-7">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-gold/20 bg-gold/[0.12] px-4 py-2 text-sm font-semibold leading-snug text-gold shadow-[0_14px_34px_rgba(212,175,55,0.10)] animate-in-up">
              <Coffee className="h-4 w-4 shrink-0" />
              <span className="min-w-0">Coffee &amp; Creative Studio Sessions</span>
            </div>
            <h1 className="font-sans text-5xl font-black leading-[0.98] tracking-tight text-white text-balance md:text-6xl lg:text-7xl">
               Capture the <span className="text-gold italic">moment</span>,<br />
               savor the <span className="text-gold italic">flavor</span>.
             </h1>
            <p className="max-w-2xl text-lg font-light leading-relaxed text-cream/78 md:text-xl">
              CAV combines a premium, fully-equipped photography studio with a curated boutique café.
              Express yourself in front of the lens while enjoying rich artisanal coffees.
            </p>
            <div className="flex max-w-full flex-col gap-4 pt-2 sm:flex-row">
              <Button variant="gold" size="xl" onClick={handleBookNow} className="group">
                Start Your Studio Session
                <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <a href="#cafe" className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-cream/20 px-6 py-4 text-sm font-semibold text-cream shadow-[0_12px_30px_rgba(0,0,0,0.10)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-cream/45 hover:bg-white/8 hover:shadow-[0_16px_36px_rgba(0,0,0,0.16)] active:translate-y-0 active:scale-[0.98] md:px-8">
                Explore Café Favorites
              </a>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-5">
            <div className="group relative mx-auto aspect-[4/5] w-full max-w-[430px] overflow-hidden rounded-[24px] border border-white/10 shadow-[0_34px_90px_rgba(0,0,0,0.34)]">
              <img
                src={businessAssets.hero}
                alt="Professional studio setup with camera and lighting equipment"
                loading="lazy"
                style={{ objectPosition: '50% 32%' }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              />
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-espresso-dark/92 via-espresso-dark/10 to-transparent p-6 md:p-8">
                <div className="mb-2 flex items-center gap-1 text-gold">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                </div>
                <p className="mb-1 text-sm font-light italic">&ldquo;Fun studio sessions and excellent coffee.&rdquo;</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gold">- Angela C., Studio Client</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Studio Section */}
      <section id="studio" className="premium-section bg-cream-dark">
        <div className="max-w-5xl mx-auto space-y-14 md:space-y-[4.5rem]">
          {/* Section Header */}
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <span className="text-gold font-bold uppercase tracking-[0.18em] text-xs md:text-sm">1. Choose Service</span>
            <h2 className="font-sans text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.04] text-espresso text-balance">
              Choose between a studio session or full photo service booking
            </h2>
            <p className="text-espresso/70 text-base md:text-lg leading-relaxed">Let's create amazing memories together.</p>
          </div>

          {/* Service Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {services.map((svc) => (
              <button
                key={recordKey(svc, svc.name)}
                type="button"
                onClick={() => {
                  setLandingSelectedService(svc);
                  setLandingPackageSlide(0);
                }}
                className={`relative overflow-hidden rounded-[24px] border text-left flex flex-col transition-all duration-300 ease-out group bg-white/95 shadow-[0_18px_45px_rgba(46,26,17,0.07)] hover:-translate-y-1 hover:shadow-[0_28px_70px_rgba(46,26,17,0.12)] ${
                  landingSelectedService?.id === svc.id
                    ? 'border-gold shadow-[0_24px_70px_rgba(212,175,55,0.18)] scale-[1.01]'
                    : 'border-espresso/[0.06] hover:border-espresso/15'
                }`}
              >
                {/* Hero Image */}
                <div className="relative w-full aspect-[4/3] overflow-hidden shrink-0">
                  <img
                    src={svc.image_url}
                    alt={svc.name}
                    loading="lazy"
                    style={{ objectPosition: svc.image_position || '50% 34%' }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  {svc.duration_minutes && (
                    <span className="absolute top-3 left-3 bg-espresso/85 text-gold text-[10px] font-bold px-3 py-1 rounded-full backdrop-blur-sm uppercase tracking-wider">
                      {svc.duration_minutes} Min Session
                    </span>
                  )}
                  {landingSelectedService?.id === svc.id && (
                    <span className="absolute top-3 right-3 bg-gold text-cream rounded-full p-1 shadow-md">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                  {/* Icon badge */}
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-white border-4 border-cream-dark flex items-center justify-center shadow-[0_12px_26px_rgba(46,26,17,0.12)]">
                    <Camera className="w-5 h-5 text-gold" />
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-6 pt-8 flex-1 flex flex-col gap-3 text-center">
                  <h3 className="font-sans text-2xl font-extrabold tracking-tight text-espresso">{svc.name}</h3>
                  <p className="text-espresso/68 text-sm leading-relaxed flex-1">{svc.description}</p>
                  <div className="flex justify-between items-center pt-4 border-t border-espresso/[0.06] mt-auto">
                    <span className="text-sm font-bold text-gold">From PHP {svc.base_price}</span>
                    <span className={`text-[11px] font-extrabold px-4 py-1.5 rounded-lg uppercase tracking-wider transition-all duration-300 ${
                      landingSelectedService?.id === svc.id
                        ? 'bg-gold text-cream'
                        : 'bg-espresso/5 text-espresso/65 group-hover:bg-espresso/10'
                    }`}>
                      {landingSelectedService?.id === svc.id ? 'Selected ✓' : 'Select'}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Package Carousel — shown when a service is selected */}
          {landingSelectedService && (() => {
            const svc = landingSelectedService;
            const packages = svc.packages || [];
            const slides = [];
            for (let i = 0; i < packages.length; i += landingCardsPerSlide) {
              slides.push(packages.slice(i, i + landingCardsPerSlide));
            }
            const totalSlides = Math.max(1, slides.length);
            const safeSlide = Math.min(landingPackageSlide, totalSlides - 1);
            const handlePrev = () => setLandingPackageSlide(s => Math.max(0, s - 1));
            const handleNext = () => setLandingPackageSlide(s => Math.min(totalSlides - 1, s + 1));

            return (
              <div className="bg-white/95 rounded-[24px] border border-espresso/[0.06] shadow-[0_24px_70px_rgba(46,26,17,0.09)] p-6 md:p-8 space-y-6 animate-in-up">
                {/* Carousel Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[18px] bg-gold/10 flex items-center justify-center">
                      <Camera className="w-5 h-5 text-gold" />
                    </div>
                    <div>
                      <h4 className="font-extrabold tracking-tight text-espresso text-base">{svc.name} Packages</h4>
                      <p className="text-sm text-espresso/65">Select a package that fits your needs</p>
                    </div>
                  </div>
                  {totalSlides > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrev}
                        disabled={safeSlide === 0}
                        className="p-2 rounded-full border border-espresso/[0.06] bg-cream hover:bg-cream-dark disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                      >
                        <ChevronLeft className="w-3.5 h-3.5 text-espresso" />
                      </button>
                      <span className="text-xs font-bold text-espresso/50 min-w-[32px] text-center">{safeSlide + 1} / {totalSlides}</span>
                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={safeSlide === totalSlides - 1}
                        className="p-2 rounded-full border border-espresso/[0.06] bg-cream hover:bg-cream-dark disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                      >
                        <ChevronRight className="w-3.5 h-3.5 text-espresso" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Slides */}
                <div className="relative overflow-hidden">
                  {/* Outer nav arrows */}
                  {totalSlides > 1 && safeSlide > 0 && (
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-9 h-9 rounded-full bg-white border border-espresso/[0.06] shadow-[0_12px_30px_rgba(46,26,17,0.12)] flex items-center justify-center hover:bg-cream transition-all duration-300"
                    >
                      <ChevronLeft className="w-4 h-4 text-espresso" />
                    </button>
                  )}
                  {totalSlides > 1 && safeSlide < totalSlides - 1 && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-9 h-9 rounded-full bg-white border border-espresso/[0.06] shadow-[0_12px_30px_rgba(46,26,17,0.12)] flex items-center justify-center hover:bg-cream transition-all duration-300"
                    >
                      <ChevronRight className="w-4 h-4 text-espresso" />
                    </button>
                  )}

                  <div
                    className="flex transition-transform duration-400 ease-in-out"
                    style={{ transform: `translateX(-${safeSlide * 100}%)` }}
                    onTouchStart={e => { e.currentTarget.dataset.touchX = e.touches[0].clientX; }}
                    onTouchEnd={e => {
                      const diff = parseFloat(e.currentTarget.dataset.touchX || '0') - e.changedTouches[0].clientX;
                      if (Math.abs(diff) > 50) {
                        if (diff > 0 && safeSlide < totalSlides - 1) handleNext();
                        if (diff < 0 && safeSlide > 0) handlePrev();
                      }
                    }}
                  >
                    {slides.map((slidePkgs, si) => (
                      <div key={slidePkgs.map(pkg => recordKey(pkg, pkg.name)).join('-') || si} className="flex shrink-0 w-full gap-4" style={{ flex: '0 0 100%' }}>
                        {slidePkgs.map(pkg => {
                          const parsed = parseDescription(pkg.description);
                          return (
                            <div
                              key={recordKey(pkg, `${svc.id}-${pkg.name}`)}
                              style={{ flex: `0 0 calc(${100 / landingCardsPerSlide}% - ${landingCardsPerSlide > 1 ? '8px' : '0px'})` }}
                              className="bg-cream rounded-[22px] border border-espresso/[0.06] p-5 flex flex-col gap-4 shadow-[0_12px_30px_rgba(46,26,17,0.05)]"
                            >
                              {pkg.image_url && (
                                <div className="aspect-[4/3] overflow-hidden rounded-[18px] bg-white">
                                  <img
                                    src={pkg.image_url}
                                    alt={`${pkg.name} sample`}
                                    loading="lazy"
                                    style={{ objectPosition: pkg.image_position || '50% 34%' }}
                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  />
                                </div>
                              )}
                              {/* Top row */}
                              <div className="flex items-start gap-3">
                                <div className="p-2.5 rounded-[16px] bg-gold/10 text-gold shrink-0">
                                  {getPackageIcon(pkg.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h5 className="font-extrabold text-espresso text-sm leading-tight">{pkg.name}</h5>
                                  {parsed.isSplit ? (
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                      <span className="text-[10px] font-bold text-gold">{parsed.persons} • {parsed.shots}</span>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-espresso/65 mt-0.5">{pkg.description}</p>
                                  )}
                                </div>
                              </div>
                              {/* Inclusions */}
                              <p className="text-[12px] text-espresso/68 leading-relaxed flex-1">
                                {pkg.inclusions}
                              </p>
                              {/* Price */}
                              <div className="pt-3 border-t border-espresso/[0.06]">
                                <span className="text-gold font-extrabold text-base">PHP {pkg.price}</span>
                              </div>
                            </div>
                          );
                        })}
                        {slidePkgs.length < landingCardsPerSlide && (
                          <div style={{ flex: `0 0 calc(${100 / landingCardsPerSlide}% - 8px)` }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dot indicators */}
                {totalSlides > 1 && (
                  <div className="flex justify-center gap-1.5">
                    {Array.from({ length: totalSlides }).map((_, di) => (
                      <button
                        key={di}
                        type="button"
                        onClick={() => setLandingPackageSlide(di)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          di === safeSlide ? 'bg-gold w-5' : 'bg-espresso/25 w-1.5 hover:bg-espresso/45'
                        }`}
                      />
                    ))}
                  </div>
                )}

                {/* CTA */}
                <button
                  type="button"
                  onClick={handleBookNow}
                  className="w-full bg-espresso text-cream py-4 rounded-[20px] font-bold text-sm flex items-center justify-center gap-2 hover:bg-espresso-light transition-all duration-300 shadow-[0_14px_34px_rgba(46,26,17,0.16)] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(46,26,17,0.22)] active:translate-y-0 active:scale-[0.98]"
                >
                  <CalendarCheck className="w-4 h-4" /> Reserve This Package
                </button>
                <p className="text-center text-[11px] text-espresso/40">🔒 Secure booking • Easy process • Quality results</p>
              </div>
            );
          })()}

          {/* Fallback CTA if no service selected */}
          {!landingSelectedService && services.length > 0 && (
            <div className="text-center">
              <p className="text-sm text-espresso/65 mb-5">Select a service above to view available packages.</p>
              <button
                type="button"
                onClick={handleBookNow}
                className="inline-flex items-center gap-2 bg-espresso text-cream px-8 py-3.5 rounded-[20px] font-bold text-sm hover:bg-espresso-light transition-all duration-300 shadow-[0_14px_34px_rgba(46,26,17,0.16)] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(46,26,17,0.22)] active:translate-y-0 active:scale-[0.98]"
              >
                <ArrowRight className="w-4 h-4" /> Explore Packages
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Cafe Section */}
      <section id="cafe" className="premium-section bg-cream">
        <div className="max-w-7xl mx-auto space-y-12 md:space-y-[4.5rem]">
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <span className="text-gold font-bold uppercase tracking-[0.18em] text-xs md:text-sm">Artisanal Café</span>
            <h2 className="font-sans text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.04] text-espresso text-balance">From the Espresso Bar</h2>
            <p className="text-espresso/70 text-base md:text-lg leading-relaxed">
              Refresh and re-energize. Our coffees are brewed from premium hand-picked beans, and pastries are freshly baked daily.
            </p>
          </div>

          <CafeCarousel items={cafeItems} />
        </div>
      </section>

      <GallerySection images={galleryImages} />

      {/* About Section */}
      <section id="about" className="premium-section bg-espresso-dark text-cream relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-gold via-transparent to-transparent" />
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-center relative z-10">
          <div className="space-y-6 md:space-y-7">
            <span className="text-gold font-bold uppercase tracking-[0.18em] text-xs md:text-sm">About CAV</span>
            <h2 className="font-sans text-4xl md:text-5xl font-extrabold leading-[1.05] text-white text-balance">Blending Lens &amp; Aroma</h2>
            <p className="text-cream/72 leading-relaxed text-base md:text-lg">
              CAV was founded by a team of professional photographers and specialty baristas. We wanted to create a comfortable space where creatives, friends, and co-workers can gather.
            </p>
            <p className="text-cream/72 leading-relaxed text-base md:text-lg">
              Whether you are here for a portfolio headshot, graduation portraits, or simply a warm espresso, we strive to deliver professional quality and premium warmth.
            </p>
            <div className="flex items-center gap-6 md:gap-10 pt-2">
              <div>
                <span className="font-sans text-2xl md:text-3xl font-black text-white">5k+</span>
                <span className="text-[10px] uppercase text-cream/65 tracking-wider block">Sessions Booked</span>
              </div>
              <div className="w-px h-10 bg-cream/10" />
              <div>
                <span className="font-sans text-2xl md:text-3xl font-black text-white">100%</span>
                <span className="text-[10px] uppercase text-cream/65 tracking-wider block">Fresh Arabica</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 md:gap-5">
            <img src={businessAssets.store} alt="CAV storefront" loading="lazy" style={{ objectPosition: '50% 42%' }} className="rounded-[24px] h-44 md:h-60 w-full object-cover shadow-[0_24px_70px_rgba(0,0,0,0.28)]" />
            <img src={businessAssets.hero} alt="CAV studio interior" loading="lazy" style={{ objectPosition: '50% 32%' }} className="rounded-[24px] h-44 md:h-60 w-full object-cover shadow-[0_24px_70px_rgba(0,0,0,0.28)] mt-6 md:mt-10" />
          </div>
        </div>
      </section>

      {/* Info Bar */}
      <section className="bg-cream-dark border-y border-espresso/[0.06] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-center gap-6 md:gap-8 text-sm text-espresso/70">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gold" />
            <span>028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas</span>
          </div>
          <div className="hidden sm:block w-px h-4 bg-espresso/10" />
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold" />
            <span>Daily: 9:00 AM – 8:00 PM</span>
          </div>
          <div className="hidden sm:block w-px h-4 bg-espresso/10" />
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-gold" />
            <span>cav.photostudio.cafe@gmail.com</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-espresso-dark py-10 md:py-14 px-4 sm:px-6 border-t border-white/5 text-cream/65 text-xs md:text-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
          <div className="flex items-center gap-2.5">
            <div className="bg-gold text-espresso p-1.5 rounded-lg">
              <Camera className="w-4 h-4" />
            </div>
            <span className="font-sans text-base font-extrabold text-white">CAV Studio &amp; Café</span>
          </div>
          <p>&copy; 2026 CAV Capstone Project. All rights reserved.</p>
          <div className="flex gap-4 md:gap-6">
            <Link to="/login" className="hover:text-white transition-colors">Staff Login</Link>
            <Link to="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </footer>

      {/* Chatbot */}
      <div className="fixed bottom-4 right-4 md:bottom-5 md:right-5 z-50">
        {!chatOpen ? (
          <button
            onClick={() => setChatOpen(true)}
            className="relative w-12 h-12 bg-espresso hover:bg-espresso-light text-gold rounded-full shadow-[0_16px_36px_rgba(28,15,10,0.28)] hover:scale-105 active:scale-95 transition-all border border-gold/25 flex items-center justify-center focus-visible:outline-gold"
            aria-label="Open chat"
          >
            <span className="absolute inset-0 rounded-full bg-gold/20 animate-ping" />
            <MessageSquare className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-72 sm:w-96 h-[480px] bg-white rounded-3xl shadow-2xl border border-espresso/10 flex flex-col overflow-hidden animate-in-up">
            <div className="bg-espresso text-cream px-4 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="bg-gold/15 text-gold p-1.5 rounded-lg">
                  <Coffee className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">CAV AI Assistant</h4>
                  <span className="text-[10px] text-gold/80">Online &middot; FAQ Assistant</span>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-cream/50 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-cream/30 scrollbar-thin">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-espresso text-cream rounded-tr-md'
                      : 'bg-white text-espresso rounded-tl-md border border-espresso/5'
                  }`}>
                    {msg.role === 'assistant' ? <ChatbotMessageContent content={msg.content} /> : msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start animate-in">
                  <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 border border-espresso/5 shadow-sm">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                      <span className="w-2 h-2 bg-gold/60 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                    </div>
                  </div>
                </div>
              )}
              <ChatbotFaqPrompts
                onSelect={sendChatMessage}
                disabled={chatLoading}
                prompts={chatFaqPrompts.length ? chatFaqPrompts : undefined}
                shouldMinimize={chatInput.trim().length > 0}
              />
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleChatSubmit} className="p-3 border-t border-espresso/10 bg-white shrink-0" aria-label="Chat form">
              <label htmlFor="lp-chat-input" className="block text-xs font-semibold text-espresso mb-1.5">Chat message</label>
              <div className="flex gap-2">
                <input
                  id="lp-chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about hours, pricing, packages..."
                  className="flex-1 bg-cream text-xs px-3.5 py-2.5 rounded-xl border border-espresso/5 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/20 transition-all"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="bg-espresso text-gold hover:bg-espresso-light disabled:opacity-40 p-2.5 rounded-xl transition-all"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
