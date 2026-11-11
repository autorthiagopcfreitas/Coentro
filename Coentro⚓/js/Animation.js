// Simple animation utility to replace GSAP for Chrome extension compatibility
class Animation {
	static fromTo(elements, fromProps, toProps) {
		if (!elements) return;
		
		// Handle NodeList, HTMLCollection, or single element
		const elems = elements.length && elements.length > 0 ? Array.from(elements) : 
		              elements.nodeType ? [elements] : [];
		
		if (elems.length === 0) return;
		
		elems.forEach((elem, index) => {
			if (!elem || !elem.style) return;
			
			const delay = (toProps.stagger || 0) * index + (toProps.delay || 0);
			const duration = toProps.duration || 0.5;
			
			// Apply initial state immediately
			if (fromProps.opacity !== undefined) elem.style.opacity = fromProps.opacity;
			if (fromProps.scale !== undefined) {
				elem.style.transform = `scale(${fromProps.scale})`;
				elem.style.transformOrigin = 'center';
			}
			if (fromProps.x !== undefined) {
				const currentTransform = elem.style.transform || '';
				elem.style.transform = `${currentTransform} translateX(${fromProps.x}px)`.trim();
			}
			if (fromProps.y !== undefined) {
				const currentTransform = elem.style.transform || '';
				elem.style.transform = `${currentTransform} translateY(${fromProps.y}px)`.trim();
			}
			// SVG stroke properties
			if (fromProps.strokeDasharray !== undefined) {
				elem.setAttribute('stroke-dasharray', fromProps.strokeDasharray);
			}
			if (fromProps.strokeDashoffset !== undefined) {
				elem.setAttribute('stroke-dashoffset', fromProps.strokeDashoffset);
			}
			
			// Force reflow to ensure initial state is applied
			void elem.offsetHeight;
			
			// Animate to final state
			setTimeout(() => {
				if (!elem || !elem.style) return;
				
				const transition = `all ${duration}s ${this.getEasing(toProps.ease || 'ease')}`;
				elem.style.transition = transition;
				
				if (toProps.opacity !== undefined) elem.style.opacity = toProps.opacity;
				if (toProps.scale !== undefined) {
					let currentTransform = elem.style.transform || '';
					currentTransform = currentTransform.replace(/scale\([^)]*\)/g, '').trim();
					elem.style.transform = `${currentTransform} scale(${toProps.scale})`.trim();
				}
				if (toProps.x !== undefined) {
					let currentTransform = elem.style.transform || '';
					currentTransform = currentTransform.replace(/translateX\([^)]*\)/g, '').trim();
					elem.style.transform = `${currentTransform} translateX(${toProps.x}px)`.trim();
				}
				if (toProps.y !== undefined) {
					let currentTransform = elem.style.transform || '';
					currentTransform = currentTransform.replace(/translateY\([^)]*\)/g, '').trim();
					elem.style.transform = `${currentTransform} translateY(${toProps.y}px)`.trim();
				}
				if (toProps.width !== undefined) elem.style.width = toProps.width;
				// SVG stroke properties
				if (toProps.strokeDasharray !== undefined) {
					elem.setAttribute('stroke-dasharray', toProps.strokeDasharray);
				}
				if (toProps.strokeDashoffset !== undefined) {
					elem.setAttribute('stroke-dashoffset', toProps.strokeDashoffset);
				}
			}, delay * 1000);
		});
	}
	
	static to(element, props) {
		if (!element) return;
		
		const duration = props.duration || 0.5;
		const delay = props.delay || 0;
		
		setTimeout(() => {
			if (!element) return;
			
			const transition = `all ${duration}s ${this.getEasing(props.ease || 'ease')}`;
			if (element.style) {
				element.style.transition = transition;
			}
			
			if (props.opacity !== undefined && element.style) {
				element.style.opacity = props.opacity;
			}
			if (props.scale !== undefined && element.style) {
				const currentTransform = element.style.transform || '';
				element.style.transform = `${currentTransform} scale(${props.scale})`.trim();
			}
			if (props.strokeDashoffset !== undefined) {
				element.setAttribute('stroke-dashoffset', props.strokeDashoffset);
			}
			if (props.strokeDasharray !== undefined) {
				element.setAttribute('stroke-dasharray', props.strokeDasharray);
			}
			if (props.width !== undefined && element.style) {
				element.style.width = props.width;
			}
		}, delay * 1000);
	}
	
	// Calculate polyline length from points
	static calculatePolylineLength(element) {
		if (!element) return 1000;
		
		// If it's a path, use getTotalLength
		if (element.getTotalLength && element.tagName === 'path') {
			return element.getTotalLength();
		}
		
		// For polyline, calculate from points
		if (element.tagName === 'polyline' || element.tagName === 'POLYLINE') {
			const pointsAttr = element.getAttribute('points');
			if (!pointsAttr) return 1000;
			
			const points = pointsAttr.trim().split(/[\s,]+/).map(Number);
			let length = 0;
			
			for (let i = 0; i < points.length - 2; i += 2) {
				const x1 = points[i];
				const y1 = points[i + 1];
				const x2 = points[i + 2];
				const y2 = points[i + 3];
				
				if (x2 !== undefined && y2 !== undefined) {
					const dx = x2 - x1;
					const dy = y2 - y1;
					length += Math.sqrt(dx * dx + dy * dy);
				}
			}
			
			return length || 1000;
		}
		
		return 1000;
	}
	
	// Animate SVG path/polyline drawing effect
	static drawPath(element, duration = 2) {
		if (!element) return;
		
		const pathLength = this.calculatePolylineLength(element);
		element.setAttribute('stroke-dasharray', pathLength);
		element.setAttribute('stroke-dashoffset', pathLength);
		
		setTimeout(() => {
			if (!element) return;
			element.style.transition = `stroke-dashoffset ${duration}s ease-out`;
			element.setAttribute('stroke-dashoffset', '0');
		}, 50);
	}
	
	// Create pulsing animation
	static pulse(element, options = {}) {
		if (!element) return;
		
		const scale = options.scale || 1.15;
		const duration = options.duration || 1;
		const repeat = options.repeat || -1; // -1 for infinite
		const delay = options.delay || 0;
		const isSVG = element.namespaceURI === 'http://www.w3.org/2000/svg';
		
		let iterations = 0;
		const animate = () => {
			if (repeat !== -1 && iterations >= repeat) return;
			iterations++;
			
			setTimeout(() => {
				if (!element) return;
				
				if (isSVG) {
					// For SVG elements, animate the 'r' attribute for circles or use transform attribute
					if (element.tagName === 'circle' || element.tagName === 'CIRCLE') {
						const originalR = parseFloat(element.getAttribute('r')) || 3;
						element.style.transition = `r ${duration}s ease-in-out`;
						element.setAttribute('r', originalR * scale);
						
						setTimeout(() => {
							if (!element) return;
							element.style.transition = `r ${duration}s ease-in-out`;
							element.setAttribute('r', originalR);
							
							if (repeat === -1 || iterations < repeat) {
								setTimeout(animate, duration * 1000);
							}
						}, duration * 1000);
					} else {
						// For other SVG elements, use transform attribute
						const cx = element.getAttribute('cx') || 0;
						const cy = element.getAttribute('cy') || 0;
						element.style.transition = `transform ${duration}s ease-in-out`;
						element.style.transformOrigin = `${cx}px ${cy}px`;
						element.style.transform = `scale(${scale})`;
						
						setTimeout(() => {
							if (!element) return;
							element.style.transition = `transform ${duration}s ease-in-out`;
							element.style.transform = 'scale(1)';
							
							if (repeat === -1 || iterations < repeat) {
								setTimeout(animate, duration * 1000);
							}
						}, duration * 1000);
					}
				} else {
					// For HTML elements, use style.transform
					if (!element.style) return;
					element.style.transition = `transform ${duration}s ease-in-out`;
					element.style.transformOrigin = 'center';
					element.style.transform = `scale(${scale})`;
					
					setTimeout(() => {
						if (!element || !element.style) return;
						element.style.transition = `transform ${duration}s ease-in-out`;
						element.style.transform = 'scale(1)';
						
						if (repeat === -1 || iterations < repeat) {
							setTimeout(animate, duration * 1000);
						}
					}, duration * 1000);
				}
			}, delay * 1000);
		};
		
		animate();
	}
	
	// Pulse opacity
	static pulseOpacity(element, options = {}) {
		if (!element) return;
		
		const minOpacity = options.minOpacity || 0.5;
		const duration = options.duration || 1;
		const repeat = options.repeat || -1;
		const delay = options.delay || 0;
		
		let iterations = 0;
		const animate = () => {
			if (repeat !== -1 && iterations >= repeat) return;
			iterations++;
			
			setTimeout(() => {
				if (!element || !element.style) return;
				element.style.transition = `opacity ${duration}s ease-in-out`;
				element.style.opacity = minOpacity;
				
				setTimeout(() => {
					if (!element || !element.style) return;
					element.style.transition = `opacity ${duration}s ease-in-out`;
					element.style.opacity = '1';
					
					if (repeat === -1 || iterations < repeat) {
						setTimeout(animate, duration * 1000);
					}
				}, duration * 1000);
			}, delay * 1000);
		};
		
		animate();
	}
	
	static getEasing(ease) {
		const easings = {
			'ease': 'ease',
			'linear': 'linear',
			'ease-in': 'ease-in',
			'ease-out': 'ease-out',
			'ease-in-out': 'ease-in-out',
			'power2.out': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
			'power2.inOut': 'cubic-bezier(0.645, 0.045, 0.355, 1)',
			'power3.out': 'cubic-bezier(0.215, 0.61, 0.355, 1)',
			'back.out(1.7)': 'cubic-bezier(0.34, 1.56, 0.64, 1)'
		};
		return easings[ease] || 'ease';
	}
}

// Create a gsap-like global object for compatibility
if (typeof window !== 'undefined') {
	window.gsap = {
		fromTo: (elements, fromProps, toProps) => Animation.fromTo(elements, fromProps, toProps),
		to: (element, props) => Animation.to(element, props),
		drawPath: (element, duration) => Animation.drawPath(element, duration),
		pulse: (element, options) => Animation.pulse(element, options),
		pulseOpacity: (element, options) => Animation.pulseOpacity(element, options)
	};
}
