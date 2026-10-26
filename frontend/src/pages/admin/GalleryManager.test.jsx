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
    client.get.mockResolvedValue({ data: [galleryRecord] });
  });

  test('loads managed gallery images and exposes their visibility status', async () => {
    render(<GalleryManager />);

    expect(await screen.findByText('Studio portrait')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
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

});
