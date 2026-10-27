import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GalleryManager from './GalleryManager';
import client from '../../api/client';

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  getApiErrorMessage: jest.fn((error, fallback) => error?.message || fallback),
}));

const galleryRecord = {
  id: 7,
  title: 'Studio portrait',
  category: 'STUDIO',
  category_label: 'Studio',
  image_url: 'https://images.example.test/gallery/portrait.png',
  alt_text: 'A portrait in the studio',
  caption: 'A sample caption',
  is_featured: true,
  sort_order: 2,
};

describe('GalleryManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
    client.get.mockResolvedValue({ data: [galleryRecord] });
  });

  test('loads managed gallery images and exposes their visibility status', async () => {
    render(<GalleryManager />);

    expect(await screen.findByText('Studio portrait')).toBeInTheDocument();
    expect(screen.getAllByText('Public')).toHaveLength(2);
    expect(client.get).toHaveBeenCalledWith('/api/gallery/images/', {
      params: { include_unfeatured: 'true' },
    });
  });

  test('edits a gallery entry and reloads the list', async () => {
    client.patch.mockResolvedValue({ data: { ...galleryRecord, title: 'New studio title' } });
    render(<GalleryManager />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Studio portrait' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New studio title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(client.patch).toHaveBeenCalledWith(
      '/api/gallery/images/7/', expect.any(FormData),
    ));
    expect(await screen.findByText('Gallery image updated.')).toBeInTheDocument();
  });

  test('requires a file before creating a gallery image', async () => {
    render(<GalleryManager />);
    await screen.findByText('Managed Gallery');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload Image' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image file to upload.');
    expect(client.post).not.toHaveBeenCalled();
  });

  test('submits a selected image as multipart data', async () => {
    client.post.mockResolvedValue({ data: galleryRecord });
    render(<GalleryManager />);
    await screen.findByText('Studio portrait');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Uploaded image' } });
    const upload = new File(['png-bytes'], 'sample.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [upload] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload Image' }));

    await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/gallery/images/', expect.any(FormData)));
    const formData = client.post.mock.calls[0][1];
    expect(formData.get('title')).toBe('Uploaded image');
    expect(formData.get('image')).toBe(upload);
  });

  test('shows a replacement prompt when a stored image URL cannot be loaded', async () => {
    render(<GalleryManager />);
    const image = await screen.findByRole('img', { name: 'A portrait in the studio' });

    fireEvent.error(image);

    expect(await screen.findByText('This image could not be loaded. Upload a replacement to restore it.')).toBeInTheDocument();
  });

  test('opens an accessible preview and supports next, previous, and Escape controls', async () => {
    const secondImage = {
      ...galleryRecord,
      id: 8,
      title: 'Café details',
      category: 'CAFE',
      category_label: 'Café',
      image_url: 'https://images.example.test/gallery/cafe.png',
    };
    client.get.mockResolvedValue({ data: [galleryRecord, secondImage] });
    render(<GalleryManager />);

    fireEvent.click(await screen.findByRole('button', { name: 'Preview Studio portrait' }));
    expect(screen.getByRole('dialog', { name: 'Image preview: Studio portrait' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByRole('dialog', { name: 'Image preview: Café details' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(screen.getByRole('dialog', { name: 'Image preview: Studio portrait' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Image preview/ })).not.toBeInTheDocument();
  });

  test('filters images by category and displays category counts', async () => {
    const secondImage = {
      ...galleryRecord,
      id: 8,
      title: 'Café details',
      category: 'CAFE',
      category_label: 'Café',
      image_url: 'https://images.example.test/gallery/cafe.png',
    };
    client.get.mockResolvedValue({ data: [galleryRecord, secondImage] });
    render(<GalleryManager />);

    expect(await screen.findByText('Studio portrait')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Café/ }));
    expect(screen.getByText('Café details')).toBeInTheDocument();
    expect(screen.queryByText('Studio portrait')).not.toBeInTheDocument();
  });

  test('deletes a gallery image and reloads the managed list', async () => {
    client.delete.mockResolvedValue({ status: 204 });
    render(<GalleryManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Studio portrait' }));

    await waitFor(() => expect(client.delete).toHaveBeenCalledWith('/api/gallery/images/7/'));
    expect(window.confirm).toHaveBeenCalledWith('Delete “Studio portrait” from the gallery?');
    expect(await screen.findByText('Gallery image deleted.')).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(2);
  });

});
