'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { SourceRead } from '@/types/api';

export interface FileUploadDropzoneProps {
  notebookId: string;
  isLocked?: boolean;
  onUploadSuccess?: (source: SourceRead) => void;
  onUploadError?: (error: string) => void;
  className?: string;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 52,428,800 bytes (50MB)

export function FileUploadDropzone({
  notebookId,
  isLocked = false,
  onUploadSuccess,
  onUploadError,
  className = '',
}: FileUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndUpload = async (file: File) => {
    setErrorMessage(null);

    // 1. Client-Side Pre-Flight Blocker (Hard 50MB Guard)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const errorMsg = 'File exceeds 50MB limit';
      setErrorMessage(errorMsg);
      onUploadError?.(errorMsg);
      // HARD STOP: Never fire any network request!
      return;
    }

    if (file.size === 0) {
      const errorMsg = 'Cannot upload an empty file';
      setErrorMessage(errorMsg);
      onUploadError?.(errorMsg);
      return;
    }

    if (isLocked) {
      const errorMsg = 'Maximum 20 sources reached';
      setErrorMessage(errorMsg);
      onUploadError?.(errorMsg);
      return;
    }

    // 2. Perform Network Upload
    try {
      setIsUploading(true);
      const FormDataConstructor =
        typeof globalThis.FormData !== 'undefined' ? globalThis.FormData : FormData;
      const formData = new FormDataConstructor();
      formData.append('file', file);
      formData.append('title', file.name);

      const createdSource = await apiClient.createSource(notebookId, formData);
      onUploadSuccess?.(createdSource);
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : 'Upload failed. Please check network and try again.';
      setErrorMessage(errorText);
      onUploadError?.(errorText);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isLocked && !isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isLocked || isUploading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await validateAndUpload(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await validateAndUpload(file);
    }
  };

  const handleContainerClick = () => {
    if (!isLocked && !isUploading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div
        role="button"
        tabIndex={isLocked ? -1 : 0}
        aria-label="Upload PDF or document"
        title={isLocked ? 'Maximum 20 sources reached' : 'Click or drop files to upload'}
        onClick={handleContainerClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/10'
            : isLocked
            ? 'border-border bg-muted/40 opacity-60 cursor-not-allowed'
            : 'border-border hover:border-primary/50 hover:bg-accent/5 cursor-pointer'
        }`}
        data-testid="file-upload-dropzone"
        data-locked={isLocked ? 'true' : 'false'}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          disabled={isLocked || isUploading}
          onChange={handleFileChange}
          className="hidden"
          data-testid="file-input"
        />

        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" data-testid="uploading-spinner" />
          ) : (
            <UploadCloud className="h-6 w-6 text-primary" />
          )}

          <div className="text-xs font-semibold text-foreground">
            {isUploading
              ? 'Uploading and preparing vectors...'
              : isLocked
              ? 'Maximum 20 sources reached'
              : 'Drop PDF or click to browse'}
          </div>

          <div className="text-[11px] text-muted-foreground">
            Max 50MB per file (PDF, PNG, JPG)
          </div>
        </div>
      </div>

      {/* Client-Side Validation or Backend Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          data-testid="upload-error-message"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="leading-tight">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
