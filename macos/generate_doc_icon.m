#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>

// Create portrait folded-corner macOS document sheet path (688 x 864 centered in 1024 x 1024)
static NSBezierPath *CreateDocumentSheetPath(CGFloat left, CGFloat bottom, CGFloat width, CGFloat height, CGFloat radius, CGFloat foldSize) {
    CGFloat right = left + width;
    CGFloat top = bottom + height;

    CGMutablePathRef p = CGPathCreateMutable();
    // Start bottom-left after corner
    CGPathMoveToPoint(p, NULL, left + radius, bottom);
    // Bottom edge -> bottom-right corner
    CGPathAddArcToPoint(p, NULL, right, bottom, right, bottom + radius, radius);
    // Right edge up to fold start
    CGPathAddLineToPoint(p, NULL, right, top - foldSize);
    // Diagonal fold edge to top edge
    CGPathAddLineToPoint(p, NULL, right - foldSize, top);
    // Top edge -> top-left corner
    CGPathAddArcToPoint(p, NULL, left, top, left, top - radius, radius);
    // Left edge -> bottom-left corner
    CGPathAddArcToPoint(p, NULL, left, bottom, left + radius, bottom, radius);
    CGPathCloseSubpath(p);

    NSBezierPath *nsPath = [NSBezierPath bezierPath];
    // Convert CGPath to NSBezierPath via CGContext or manual segments; let's return NSBezierPath directly:
    [nsPath moveToPoint:NSMakePoint(left + radius, bottom)];
    [nsPath lineToPoint:NSMakePoint(right - radius, bottom)];
    [nsPath appendBezierPathWithArcWithCenter:NSMakePoint(right - radius, bottom + radius) radius:radius startAngle:270 endAngle:360 clockwise:NO];
    [nsPath lineToPoint:NSMakePoint(right, top - foldSize)];
    [nsPath lineToPoint:NSMakePoint(right - foldSize, top)];
    [nsPath lineToPoint:NSMakePoint(left + radius, top)];
    [nsPath appendBezierPathWithArcWithCenter:NSMakePoint(left + radius, top - radius) radius:radius startAngle:90 endAngle:180 clockwise:NO];
    [nsPath lineToPoint:NSMakePoint(left, bottom + radius)];
    [nsPath appendBezierPathWithArcWithCenter:NSMakePoint(left + radius, bottom + radius) radius:radius startAngle:180 endAngle:270 clockwise:NO];
    [nsPath closePath];

    CGPathRelease(p);
    return nsPath;
}

static void RenderDocIconAtSize(NSInteger pixelSize, NSString *outputPath) {
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL
                      pixelsWide:pixelSize
                      pixelsHigh:pixelSize
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSCalibratedRGBColorSpace
                     bytesPerRow:0
                    bitsPerPixel:0];

    NSGraphicsContext *ctx = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:ctx];
    ctx.shouldAntialias = YES;
    ctx.imageInterpolation = NSImageInterpolationHigh;

    CGContextRef cg = ctx.CGContext;
    CGFloat scale = (CGFloat)pixelSize / 1024.0;
    CGContextScaleCTM(cg, scale, scale);

    CGFloat sheetX = 176.0;
    CGFloat sheetY = 82.0;
    CGFloat sheetW = 672.0;
    CGFloat sheetH = 860.0;
    CGFloat cornerR = 52.0;
    CGFloat fold = 186.0;

    NSBezierPath *sheetPath = CreateDocumentSheetPath(sheetX, sheetY, sheetW, sheetH, cornerR, fold);

    // 1. Soft Document Drop Shadow
    [NSGraphicsContext saveGraphicsState];
    if (pixelSize >= 32) {
        NSShadow *shadow = [[NSShadow alloc] init];
        shadow.shadowOffset = NSMakeSize(0, -16);
        shadow.shadowBlurRadius = 32.0;
        shadow.shadowColor = [NSColor colorWithCalibratedWhite:0.0 alpha:0.18];
        [shadow set];
    }
    [[NSColor whiteColor] setFill];
    [sheetPath fill];
    [NSGraphicsContext restoreGraphicsState];

    // 2. Crisp Paper Sheet Gradient Fill
    [NSGraphicsContext saveGraphicsState];
    [sheetPath addClip];

    NSGradient *paperGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.945 green:0.956 blue:0.976 alpha:1.0],
        [NSColor colorWithCalibratedRed:0.998 green:0.999 blue:1.000 alpha:1.0]
    ]];
    [paperGrad drawInRect:NSMakeRect(sheetX, sheetY, sheetW, sheetH) angle:90.0];

    // Subtle ruled lines across the sheet
    if (pixelSize >= 64) {
        [[NSColor colorWithCalibratedRed:0.16 green:0.24 blue:0.36 alpha:0.045] setStroke];
        for (int i = 0; i < 4; i++) {
            CGFloat ly = 330.0 + i * 116.0;
            NSBezierPath *line = [NSBezierPath bezierPath];
            line.lineWidth = 3.0;
            [line moveToPoint:NSMakePoint(sheetX + 76.0, ly)];
            [line lineToPoint:NSMakePoint(sheetX + sheetW - 76.0, ly)];
            [line stroke];
        }
    }

    // 3. Centerpiece Minimalist "M_" Emblem on the Sheet
    CGFloat strokeW = 50.0;
    CGFloat mLeft = 304.0;
    CGFloat mRight = 562.0;
    CGFloat mMid = (mLeft + mRight) / 2.0;
    CGFloat mBottom = 418.0;
    CGFloat mTop = 678.0;
    CGFloat mValley = 496.0;

    CGMutablePathRef mPath = CGPathCreateMutable();
    CGPathMoveToPoint(mPath, NULL, mLeft + strokeW * 0.5, mBottom + strokeW * 0.5);
    CGPathAddLineToPoint(mPath, NULL, mLeft + strokeW * 0.5, mTop - strokeW * 0.5);
    CGPathAddLineToPoint(mPath, NULL, mMid, mValley);
    CGPathAddLineToPoint(mPath, NULL, mRight - strokeW * 0.5, mTop - strokeW * 0.5);
    CGPathAddLineToPoint(mPath, NULL, mRight - strokeW * 0.5, mBottom + strokeW * 0.5);

    CGPathRef strokedM = CGPathCreateCopyByStrokingPath(mPath, NULL, strokeW, kCGLineCapRound, kCGLineJoinRound, 4.0);

    [NSGraphicsContext saveGraphicsState];
    CGContextAddPath(cg, strokedM);
    CGContextClip(cg);
    NSGradient *inkGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.10 green:0.12 blue:0.16 alpha:1.0],
        [NSColor colorWithCalibratedRed:0.21 green:0.24 blue:0.30 alpha:1.0]
    ]];
    [inkGrad drawInRect:NSMakeRect(mLeft, mBottom, mRight - mLeft, mTop - mBottom) angle:90.0];
    [NSGraphicsContext restoreGraphicsState];

    CGPathRelease(strokedM);
    CGPathRelease(mPath);

    // Cobalt Underscore Pill "_"
    NSRect underRect = NSMakeRect(592.0, 418.0, 108.0, 50.0);
    NSBezierPath *underPath = [NSBezierPath bezierPathWithRoundedRect:underRect xRadius:25.0 yRadius:25.0];
    [NSGraphicsContext saveGraphicsState];
    NSShadow *uShadow = [[NSShadow alloc] init];
    uShadow.shadowOffset = NSMakeSize(0, -6);
    uShadow.shadowBlurRadius = 16.0;
    uShadow.shadowColor = [NSColor colorWithCalibratedRed:0.04 green:0.42 blue:0.92 alpha:0.32];
    [uShadow set];
    [[NSColor colorWithCalibratedRed:0.05 green:0.43 blue:0.88 alpha:1.0] setFill];
    [underPath fill];
    [NSGraphicsContext restoreGraphicsState];

    [NSGraphicsContext saveGraphicsState];
    [underPath addClip];
    NSGradient *uGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.04 green:0.41 blue:0.86 alpha:1.0],
        [NSColor colorWithCalibratedRed:0.22 green:0.60 blue:1.00 alpha:1.0]
    ]];
    [uGrad drawInRect:underRect angle:0.0];
    [NSGraphicsContext restoreGraphicsState];

    // 4. Clean Bottom "MARKDOWN" Pill / Label (only on >= 64px so tiny 16px stays crisp)
    if (pixelSize >= 64) {
        NSMutableParagraphStyle *pStyle = [[NSMutableParagraphStyle alloc] init];
        pStyle.alignment = NSTextAlignmentCenter;
        NSDictionary *attrs = @{
            NSFontAttributeName: [NSFont systemFontOfSize:58.0 weight:NSFontWeightBold],
            NSForegroundColorAttributeName: [NSColor colorWithCalibratedRed:0.42 green:0.48 blue:0.57 alpha:0.85],
            NSKernAttributeName: @(6.0),
            NSParagraphStyleAttributeName: pStyle
        };
        [@"MD" drawInRect:NSMakeRect(sheetX, 178.0, sheetW, 80.0) withAttributes:attrs];
    }

    // 5. Folded Top-Right Dog-Ear Flap + Crease Shadow
    CGFloat fx = sheetX + sheetW - fold;
    CGFloat fy = sheetY + sheetH - fold;
    CGFloat flapR = 34.0;

    NSBezierPath *flapPath = [NSBezierPath bezierPath];
    [flapPath moveToPoint:NSMakePoint(fx, sheetY + sheetH)];
    [flapPath lineToPoint:NSMakePoint(fx, fy + flapR)];
    [flapPath appendBezierPathWithArcWithCenter:NSMakePoint(fx + flapR, fy + flapR) radius:flapR startAngle:180 endAngle:270 clockwise:NO];
    [flapPath lineToPoint:NSMakePoint(sheetX + sheetW, fy)];
    [flapPath closePath];

    [NSGraphicsContext saveGraphicsState];
    NSShadow *flapShadow = [[NSShadow alloc] init];
    flapShadow.shadowOffset = NSMakeSize(-6, -10);
    flapShadow.shadowBlurRadius = 18.0;
    flapShadow.shadowColor = [NSColor colorWithCalibratedRed:0.08 green:0.12 blue:0.20 alpha:0.16];
    [flapShadow set];
    [[NSColor whiteColor] setFill];
    [flapPath fill];
    [NSGraphicsContext restoreGraphicsState];

    [NSGraphicsContext saveGraphicsState];
    [flapPath addClip];
    NSGradient *flapGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.89 green:0.915 blue:0.955 alpha:1.0],
        [NSColor colorWithCalibratedRed:0.985 green:0.99 blue:1.00 alpha:1.0]
    ]];
    [flapGrad drawInRect:NSMakeRect(fx, fy, fold, fold) angle:135.0];
    [NSGraphicsContext restoreGraphicsState];

    // Subtle Outer Sheet Border
    sheetPath.lineWidth = 3.5;
    [[NSColor colorWithCalibratedRed:0.12 green:0.16 blue:0.24 alpha:0.09] setStroke];
    [sheetPath stroke];

    [NSGraphicsContext restoreGraphicsState]; // end sheet clip
    [NSGraphicsContext restoreGraphicsState]; // end context

    NSData *pngData = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    [pngData writeToFile:outputPath atomically:YES];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSFileManager *fm = [NSFileManager defaultManager];
        [fm createDirectoryAtPath:@"assets" withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *iconsetDir = @"assets/DocumentIcon.iconset";
        [fm removeItemAtPath:iconsetDir error:nil];
        [fm createDirectoryAtPath:iconsetDir withIntermediateDirectories:YES attributes:nil error:nil];

        RenderDocIconAtSize(1024, @"assets/doc_icon.png");

        NSArray *specs = @[
            @[@"icon_16x16.png", @16],
            @[@"icon_16x16@2x.png", @32],
            @[@"icon_32x32.png", @32],
            @[@"icon_32x32@2x.png", @64],
            @[@"icon_128x128.png", @128],
            @[@"icon_128x128@2x.png", @256],
            @[@"icon_256x256.png", @256],
            @[@"icon_256x256@2x.png", @512],
            @[@"icon_512x512.png", @512],
            @[@"icon_512x512@2x.png", @1024]
        ];

        for (NSArray *spec in specs) {
            NSString *filename = spec[0];
            NSInteger px = [spec[1] integerValue];
            RenderDocIconAtSize(px, [iconsetDir stringByAppendingPathComponent:filename]);
        }

        printf("Generated DocumentIcon.iconset successfully.\n");
    }
    return 0;
}
