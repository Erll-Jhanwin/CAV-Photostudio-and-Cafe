const pic = (path) => encodeURI(`/assets/pics/${path}`);

const makeImage = ({ id, title, category, categoryLabel, path, alt, caption, objectPosition = '50% 34%' }) => ({
  id,
  title,
  category,
  category_label: categoryLabel,
  image_url: pic(path),
  alt_text: alt || title,
  caption: caption || '',
  object_position: objectPosition,
});

export const brandAssets = {
  logo: pic('icon/ICON.jpg'),
  favicon: pic('icon/ICON.jpg'),
};

export const businessAssets = {
  hero: pic('business/main.jpg'),
  store: pic('business/Store.jpg'),
};

const obsoleteServiceNames = new Set(['self-shoot studio', 'boutique portrait']);

const isObsoleteService = (service = {}) => obsoleteServiceNames.has(String(service.name || '').trim().toLowerCase());

const packageAssets = {
  solo: {
    serviceImage: pic('solo/solo pic landscape.jpg'),
    servicePosition: '50% 38%',
    primary: pic('solo/solo pic portrait.jpg'),
    primaryPosition: '52% 24%',
    gallery: [
      makeImage({ id: 'solo-portrait-1', title: 'Solo Portrait Session', category: 'STUDIO', categoryLabel: 'Solo', path: 'solo/solo pic portrait.jpg', alt: 'Solo portrait studio session', objectPosition: '52% 24%' }),
      makeImage({ id: 'solo-portrait-2', title: 'Solo Studio Portrait', category: 'STUDIO', categoryLabel: 'Solo', path: 'solo/solo pic portrait (2).jpg', alt: 'Solo studio portrait sample', objectPosition: '50% 24%' }),
      makeImage({ id: 'solo-portrait-3', title: 'Solo Creative Portrait', category: 'STUDIO', categoryLabel: 'Solo', path: 'solo/solo pic portrait (3).jpg', alt: 'Solo creative portrait sample', objectPosition: '50% 24%' }),
      makeImage({ id: 'solo-landscape', title: 'Solo Landscape Portrait', category: 'STUDIO', categoryLabel: 'Solo', path: 'solo/solo pic landscape.jpg', alt: 'Solo landscape studio portrait', objectPosition: '50% 38%' }),
    ],
  },
  couple: {
    serviceImage: pic('couple/studio session couple.jpg'),
    servicePosition: '50% 24%',
    primary: pic('couple/studio session couple.jpg'),
    primaryPosition: '50% 24%',
    gallery: [
      makeImage({ id: 'couple-studio-1', title: 'Couple Studio Session', category: 'STUDIO', categoryLabel: 'Couple', path: 'couple/studio session couple.jpg', alt: 'Couple studio session sample', objectPosition: '50% 24%' }),
      makeImage({ id: 'couple-studio-2', title: 'Couple Portrait Session', category: 'STUDIO', categoryLabel: 'Couple', path: 'couple/studio session couple (2).jpg', alt: 'Couple portrait studio sample', objectPosition: '50% 24%' }),
      makeImage({ id: 'couple-studio-5', title: 'Couple Props Session', category: 'STUDIO', categoryLabel: 'Couple', path: 'couple/studio session couple5.jpg', alt: 'Couple studio props session sample', objectPosition: '50% 24%' }),
    ],
  },
  friends: {
    serviceImage: pic('friends/studio session friends.jpg'),
    servicePosition: '50% 26%',
    primary: pic('friends/studio session friends.jpg'),
    primaryPosition: '50% 26%',
    gallery: [
      makeImage({ id: 'friends-studio-1', title: 'Friends Studio Session', category: 'STUDIO', categoryLabel: 'Friends', path: 'friends/studio session friends.jpg', alt: 'Friends studio session sample', objectPosition: '50% 26%' }),
      makeImage({ id: 'friends-studio-2', title: 'Friends Group Portrait', category: 'STUDIO', categoryLabel: 'Friends', path: 'friends/studio session friends (2).jpg', alt: 'Friends group portrait sample', objectPosition: '50% 34%' }),
    ],
  },
  family: {
    serviceImage: pic('family/studio session family.jpg'),
    servicePosition: '50% 30%',
    primary: pic('family/studio session family.jpg'),
    primaryPosition: '50% 30%',
    gallery: [
      makeImage({ id: 'family-studio-1', title: 'Family Studio Session', category: 'STUDIO', categoryLabel: 'Family', path: 'family/studio session family.jpg', alt: 'Family studio session sample', objectPosition: '50% 30%' }),
      makeImage({ id: 'family-studio-2', title: 'Family Portrait Session', category: 'STUDIO', categoryLabel: 'Family', path: 'family/studio session family (2).jpg', alt: 'Family portrait studio sample', objectPosition: '50% 24%' }),
    ],
  },
  birthday: {
    serviceImage: pic('birthday/studio session bday.jpg'),
    servicePosition: '48% 34%',
    primary: pic('birthday/studio session bday.jpg'),
    primaryPosition: '48% 34%',
    gallery: [
      makeImage({ id: 'birthday-studio-1', title: 'Birthday Studio Session', category: 'EVENTS', categoryLabel: 'Birthday', path: 'birthday/studio session bday.jpg', alt: 'Birthday studio session sample', objectPosition: '48% 34%' }),
      makeImage({ id: 'birthday-studio-2', title: 'Birthday Portrait Setup', category: 'EVENTS', categoryLabel: 'Birthday', path: 'birthday/studio session bday1.jpg', alt: 'Birthday portrait setup sample', objectPosition: '50% 32%' }),
      makeImage({ id: 'birthday-studio-3', title: 'Birthday Photo Session', category: 'EVENTS', categoryLabel: 'Birthday', path: 'birthday/studio session bday (2).jpg', alt: 'Birthday photo session sample', objectPosition: '50% 34%' }),
      makeImage({ id: 'birthday-studio-4', title: 'Birthday Celebration Portrait', category: 'EVENTS', categoryLabel: 'Birthday', path: 'birthday/studio session bday (3).jpg', alt: 'Birthday celebration portrait sample', objectPosition: '50% 24%' }),
      makeImage({ id: 'birthday-studio-5', title: 'Birthday Package Session', category: 'EVENTS', categoryLabel: 'Birthday', path: 'birthday/studio session bday (4).jpg', alt: 'Birthday package session sample', objectPosition: '50% 34%' }),
    ],
  },
  event: {
    serviceImage: pic('events/event.jpg'),
    servicePosition: '50% 34%',
    primary: pic('events/standard event package.jpg'),
    primaryPosition: '50% 26%',
    gallery: [
      makeImage({ id: 'event-standard-package', title: 'Standard Event Package', category: 'EVENTS', categoryLabel: 'Events', path: 'events/standard event package.jpg', alt: 'Standard event package sample', objectPosition: '50% 26%' }),
      makeImage({ id: 'event-session-1', title: 'Event Photo Coverage', category: 'EVENTS', categoryLabel: 'Events', path: 'events/event.jpg', alt: 'Event photo coverage sample', objectPosition: '50% 34%' }),
      makeImage({ id: 'event-session-2', title: 'Event Program Session', category: 'EVENTS', categoryLabel: 'Events', path: 'events/event (2).jpg', alt: 'Event program session sample', objectPosition: '50% 34%' }),
      makeImage({ id: 'event-session-3', title: 'Event Celebration Coverage', category: 'EVENTS', categoryLabel: 'Events', path: 'events/event (3).jpg', alt: 'Event celebration coverage sample', objectPosition: '50% 34%' }),
    ],
  },
};

export const localGalleryImages = [
  makeImage({ id: 'business-main', title: 'CAV Studio Main Room', category: 'BEHIND_THE_SCENES', categoryLabel: 'Business', path: 'business/main.jpg', alt: 'CAV main studio room' }),
  makeImage({ id: 'business-store', title: 'CAV Storefront', category: 'BEHIND_THE_SCENES', categoryLabel: 'Business', path: 'business/Store.jpg', alt: 'CAV Photo Studio and Cafe storefront' }),
  ...packageAssets.solo.gallery,
  ...packageAssets.couple.gallery,
  ...packageAssets.friends.gallery,
  ...packageAssets.family.gallery,
  ...packageAssets.birthday.gallery,
  ...packageAssets.event.gallery,
];

const getPackageCategory = (pkg = {}, service = {}) => {
  const text = `${pkg.name || ''} ${pkg.description || ''} ${service.name || ''}`.toLowerCase();
  if (text.includes('birthday') || text.includes('bday')) return 'birthday';
  if (text.includes('friend')) return 'friends';
  if (text.includes('family')) return 'family';
  if (text.includes('couple') || text.includes('duo') || text.includes('mr. & ms.') || text.includes('mr. and ms.')) return 'couple';
  if (text.includes('event') || text.includes('program') || text.includes('coverage')) return 'event';
  if (text.includes('solo') || text.includes('self')) return 'solo';
  return text.includes('photo service') ? 'event' : 'solo';
};

export const getPackageAssetGroup = (pkg, service) => packageAssets[getPackageCategory(pkg, service)] || packageAssets.solo;

export const getPackageImageUrl = (pkg, service) => getPackageAssetGroup(pkg, service).primary;

export const getPackageImagePosition = (pkg, service) => getPackageAssetGroup(pkg, service).primaryPosition || '50% 34%';

export const getPackageGalleryImages = (pkg, service) => getPackageAssetGroup(pkg, service).gallery;

export const getServiceImageUrl = (service = {}) => {
  const text = `${service.name || ''} ${service.description || ''}`.toLowerCase();
  if (text.includes('event') || text.includes('photo service')) return packageAssets.event.serviceImage;
  if (text.includes('birthday')) return packageAssets.birthday.serviceImage;
  if (text.includes('family')) return packageAssets.family.serviceImage;
  if (text.includes('friend')) return packageAssets.friends.serviceImage;
  if (text.includes('couple') || text.includes('duo')) return packageAssets.couple.serviceImage;
  return packageAssets.solo.serviceImage;
};

export const getServiceImagePosition = (service = {}) => {
  const text = `${service.name || ''} ${service.description || ''}`.toLowerCase();
  if (text.includes('event') || text.includes('photo service')) return packageAssets.event.servicePosition;
  if (text.includes('birthday')) return packageAssets.birthday.servicePosition;
  if (text.includes('family')) return packageAssets.family.servicePosition;
  if (text.includes('friend')) return packageAssets.friends.servicePosition;
  if (text.includes('couple') || text.includes('duo')) return packageAssets.couple.servicePosition;
  return packageAssets.solo.servicePosition;
};

export const decorateServicesWithAssets = (services = []) => (
  (Array.isArray(services) ? services : []).filter(service => !isObsoleteService(service)).map(service => ({
    ...service,
    image_url: getServiceImageUrl(service),
    image_position: getServiceImagePosition(service),
    packages: (service.packages || []).map(pkg => ({
      ...pkg,
      image_url: getPackageImageUrl(pkg, service),
      image_position: getPackageImagePosition(pkg, service),
      gallery_images: getPackageGalleryImages(pkg, service),
    })),
  }))
);
