# ===================================================================
#  add-product-images.ps1  -  Adds an "imageUrl" field to every product
#  The photos live in  assets/images/products/<slug>.jpg  where <slug>
#  is the product title in lower case with spaces turned into hyphens:
#     "Wireless Earbuds Pro"  ->  assets/images/products/wireless-earbuds-pro.jpg
#  For each product this script PATCHes ONLY the imageUrl field
#  (updateMask), so no other field is touched. Safe to run twice:
#  products that already have the right imageUrl are skipped.
# ===================================================================

$ErrorActionPreference = 'Stop'

$projectId   = 'online-shopping-b3e8d'
$apiKey      = 'AIzaSyCu498WCp0_BU35xVTX1MauBcZkSR-ENhw'
$base        = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents"
$projectRoot = Split-Path -Parent $PSScriptRoot   # the folder above /docs

function Get-Slug($title) {
  return (($title.ToLower() -replace '[^a-z0-9]+', '-').Trim('-'))
}

# ---------- 1. Read every product (page by page) ----------
Write-Host "`nReading products..." -ForegroundColor Cyan
$products = @(); $token = $null
do {
  $uri = "$base/inventory?pageSize=300&key=$apiKey"
  if ($token) { $uri += "&pageToken=$token" }
  $res = Invoke-RestMethod -Uri $uri -Method GET
  if ($res.documents) { $products += $res.documents }
  $token = $res.nextPageToken
} while ($token)
Write-Host "  Found $($products.Count) products"

# ---------- 2. Set imageUrl where a photo file exists ----------
$updated = 0; $skipped = 0; $missing = 0
foreach ($doc in $products) {
  $id       = ($doc.name -split '/')[-1]
  $title    = $doc.fields.title.stringValue
  $imageUrl = "assets/images/products/$(Get-Slug $title).jpg"

  if (-not (Test-Path (Join-Path $projectRoot $imageUrl))) {
    Write-Host "  ? $title (no photo file, skipped)" -ForegroundColor DarkYellow; $missing++; continue
  }
  if ($doc.fields.imageUrl -and $doc.fields.imageUrl.stringValue -eq $imageUrl) {
    Write-Host "  = $title (already set)" -ForegroundColor DarkGray; $skipped++; continue
  }

  $body = @{ fields = @{ imageUrl = @{ stringValue = $imageUrl } } } | ConvertTo-Json -Depth 5
  $uri  = "$base/inventory/$id`?updateMask.fieldPaths=imageUrl&currentDocument.exists=true&key=$apiKey"
  $null = Invoke-RestMethod -Uri $uri -Method PATCH -Body $body -ContentType 'application/json'
  Write-Host "  + $title" -ForegroundColor Green
  $updated++
}

Write-Host "`nDone! Updated: $updated   Already set: $skipped   No photo: $missing" -ForegroundColor Cyan
